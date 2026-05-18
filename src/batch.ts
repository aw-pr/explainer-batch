import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import {
  readState, writeState, addBatch, getBatchById, getLatestPendingBatchByProvider,
  type BatchState, type RequestState,
} from './state';
import { buildSystemPrompt, buildUserInstruction } from './prompt';
import { saveResult, OUTPUT_DIR, type SaveResult } from './output';
import { exportHtmlForJsonFiles } from './html-export';
import { calcCost, formatUsd, BATCH_DISCOUNT } from './pricing';
import { buildRepairInstruction, validateJsonOutput } from './quality';
import { getModelConfig, OPENAI_LANES, laneCustomId, parseLaneCustomId, type OpenAILane } from './model-config';
import type { InputItem } from './preprocess';
import { ClaudeProvider, OpenAIProvider, detectClaudeAuthMode, type ClaudeAuthMode, type ProviderName, type ProviderMessageResponse } from './providers';

// Optional shared batch-dashboard integration. Defaults to `<repo>/jobs`;
// override with EXPLAINER_JOBS_DIR. Job-file writes are best-effort: if the
// directory cannot be created/written (e.g. not using the dashboard), the
// pipeline continues unaffected.
const JOBS_DIR = process.env.EXPLAINER_JOBS_DIR
  ? path.resolve(process.env.EXPLAINER_JOBS_DIR)
  : path.join(__dirname, '..', 'jobs');

// Polling: wait 3 min before first check, then every 30s
// (Batches take minutes — poll eagerly once the initial window passes)
const POLL_INITIAL_WAIT_MS = 3 * 60_000;
const POLL_INTERVAL_MS = 30_000;
const POLL_SYNTH_INITIAL_WAIT_MS = 90_000; // synthesis batches are smaller/faster
const MAX_REPAIR_ATTEMPTS = 2;

interface RepairResult {
  html: string;
  usage?: ProviderMessageResponse;
}

function dateFromIso(value: string): string {
  return value.slice(0, 10);
}

async function exportSavedHtml(savedResults: SaveResult[]): Promise<void> {
  const summary = await exportHtmlForJsonFiles(savedResults.map((result) => result.jsonPath));
  if (summary.ok > 0) {
    console.log(`\nHTML export: ${summary.ok} file(s) written to ${path.basename(OUTPUT_DIR)}/`);
  }
  for (const failure of summary.failures) {
    console.error(`  ! HTML export failed for ${path.basename(failure.jsonPath)} — ${failure.error}`);
  }
}

function buildClaudeRequestContent(item: InputItem, userInstruction: string): Anthropic.MessageParam['content'] {
  if (item.isUrl && item.htmlContent) {
    return [{ type: 'text', text: `Page content from ${item.input}:\n\n${item.htmlContent}\n\n${userInstruction}` }];
  }
  const docBlock: Anthropic.DocumentBlockParam = item.isUrl
    ? { type: 'document', source: { type: 'url', url: item.input } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: item.base64Data! } };

  return [docBlock, { type: 'text', text: userInstruction }];
}

function writeJobFile(batch: BatchState, items: InputItem[]): void {
  try {
    if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });
    const job = {
      type: 'explainer',
      batchId: batch.id,
      provider: batch.provider ?? 'claude',
      model: batch.model,
      laneModel: batch.lane_model,
      synthesisModel: batch.synthesis_model,
      papers: items.map(i => i.input),
      outputDir: OUTPUT_DIR,
      submittedAt: batch.submitted_at,
    };
    fs.writeFileSync(path.join(JOBS_DIR, `${batch.id}.json`), JSON.stringify(job, null, 2));
  } catch {
    // Shared dashboard integration is optional — ignore if jobs dir is unavailable.
  }
}

function removeJobFile(batchId: string): void {
  try {
    const file = path.join(JOBS_DIR, `${batchId}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // best-effort
  }
}

function getClaudeClient(): ClaudeProvider {
  return new ClaudeProvider(process.env.ANTHROPIC_API_KEY);
}

function getOpenAIClient(): OpenAIProvider {
  return new OpenAIProvider();
}

function laneInstruction(lane: OpenAILane): string {
  return [
    'You are extracting structured evidence from one research paper.',
    `Focus lane: ${lane}.`,
    'Return concise plain text only. Include direct quantitative findings when available.',
    'Do not produce HTML.',
  ].join('\n');
}

function lanePrompt(lane: OpenAILane): string {
  return [
    `Extract the "${lane}" lane from this paper.`,
    'Write 4-8 short bullets as plain text.',
    'Prioritize empirical evidence and key results where relevant.',
  ].join('\n');
}

function useOpenAILanes(): boolean {
  const raw = (process.env.OPENAI_USE_LANES ?? '1').toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'no');
}

function sourceReferenceText(item: InputItem): string {
  if (item.source.kind === 'url') {
    return `Paper reference URL: ${item.source.url ?? item.input}`;
  }
  const filePath = item.source.filePath ?? item.filePath ?? path.join(__dirname, '..', 'input', item.input);
  return [
    `Local PDF path: ${filePath}`,
    'Read this local PDF file directly from disk and base the analysis only on this source.',
  ].join('\n');
}

function buildOpenAIInput(
  item: InputItem,
  uploadedFileId: string | null,
  userInstruction: string,
  lane?: OpenAILane
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  if (uploadedFileId) {
    content.push({ type: 'input_file', file_id: uploadedFileId });
  } else {
    content.push({ type: 'input_text', text: sourceReferenceText(item) });
  }
  content.push({ type: 'input_text', text: lane ? lanePrompt(lane) : userInstruction });
  return content;
}

function requestToInputItem(customId: string, req: RequestState): InputItem {
  const fallbackIsUrl = /^https?:\/\//i.test(req.input);
  const source = req.source ?? (
    fallbackIsUrl
      ? { kind: 'url' as const, url: req.input }
      : { kind: 'local_pdf' as const, filename: req.input, filePath: path.join(__dirname, '..', 'input', req.input) }
  );

  return {
    customId,
    input: req.input,
    source,
    isUrl: source.kind === 'url',
    filePath: source.filePath,
    focusHint: req.focusHint,
    imageOverride: req.imageOverride,
  };
}

async function maybeRepairClaude(
  client: ClaudeProvider,
  authMode: ClaudeAuthMode,
  repairModel: string,
  repairMaxTokens: number,
  rawText: string,
  expectedDate: string
): Promise<RepairResult> {
  let currentText = rawText;
  let usage: ProviderMessageResponse | undefined;

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    let parsed: unknown;
    try {
      const { extractJson, normalizeSchemaDrift } = await import('./output');
      parsed = extractJson(currentText);
      normalizeSchemaDrift(parsed as never);
    } catch {
      return { html: currentText }; // unparseable — saveResult will handle the error
    }

    const validation = validateJsonOutput(parsed, { expectedDate });
    if (validation.ok) return { html: currentText, usage };
    if (attempt === MAX_REPAIR_ATTEMPTS) return { html: currentText, usage };

    console.warn(`  ⚠ JSON validation issues: ${validation.issues.join('; ')}`);
    const repairSystem = buildRepairInstruction(validation.issues, expectedDate);
    if (authMode === 'claude_cli') {
      usage = await client.createMessageViaCli(repairModel, repairSystem, currentText);
    } else {
      usage = await client.createMessage(repairModel, repairMaxTokens, repairSystem, currentText);
    }
    currentText = usage.text;
  }

  return { html: currentText, usage };
}

async function maybeRepairOpenAI(
  client: OpenAIProvider,
  repairModel: string,
  repairMaxTokens: number,
  rawText: string,
  expectedDate: string
): Promise<RepairResult> {
  let currentText = rawText;
  let usage: ProviderMessageResponse | undefined;

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    let parsed: unknown;
    try {
      const { extractJson, normalizeSchemaDrift } = await import('./output');
      parsed = extractJson(currentText);
      normalizeSchemaDrift(parsed as never);
    } catch {
      return { html: currentText };
    }

    const validation = validateJsonOutput(parsed, { expectedDate });
    if (validation.ok) return { html: currentText, usage };
    if (attempt === MAX_REPAIR_ATTEMPTS) return { html: currentText, usage };

    console.warn(`  ⚠ JSON validation issues: ${validation.issues.join('; ')}`);
    usage = await client.createMessage(
      repairModel,
      repairMaxTokens,
      buildRepairInstruction(validation.issues, expectedDate),
      [{ role: 'user', content: [{ type: 'input_text', text: currentText }] }]
    );
    currentText = usage.text;
  }

  return { html: currentText, usage };
}

function applyUsage(
  req: RequestState,
  provider: ProviderName,
  baseModel: string,
  baseIn: number,
  baseOut: number,
  baseIsBatch: boolean,
  repairModel: string,
  repair?: ProviderMessageResponse
): void {
  const baseCost = calcCost(provider, baseModel, baseIn, baseOut, baseIsBatch);
  const repairCost = repair
    ? calcCost(provider, repairModel, repair.inputTokens, repair.outputTokens, false)
    : calcCost(provider, repairModel, 0, 0, false);

  req.usage = {
    input_tokens: baseIn + (repair?.inputTokens ?? 0),
    output_tokens: baseOut + (repair?.outputTokens ?? 0),
    standard_cost_usd: baseCost.standard_cost_usd + repairCost.standard_cost_usd,
    batch_cost_usd: baseCost.batch_cost_usd + repairCost.batch_cost_usd,
    saving_usd: (baseCost.standard_cost_usd + repairCost.standard_cost_usd) - (baseCost.batch_cost_usd + repairCost.batch_cost_usd),
  };
}

async function submitClaudeBatch(items: InputItem[]): Promise<BatchState> {
  const modelConfig = getModelConfig('claude');
  const client = getClaudeClient();
  const submittedAt = new Date().toISOString();
  const expectedDate = dateFromIso(submittedAt);
  const systemPrompt = buildSystemPrompt();

  const requests = items.map(item => ({
    customId: item.customId,
    model: modelConfig.batchModel,
    maxTokens: modelConfig.maxTokens,
    system: systemPrompt,
    content: buildClaudeRequestContent(item, buildUserInstruction(expectedDate, item.focusHint)),
  }));

  console.log(`  Submitting batch of ${items.length} request(s) using ${modelConfig.batchModel}…`);
  const batch = await client.createBatch(requests);

  console.log(`  ✓ Batch submitted: ${batch.id}`);
  console.log(`    Processing status: ${batch.status}`);

  return {
    id: batch.id,
    provider: 'claude',
    model: modelConfig.batchModel,
    submitted_at: submittedAt,
    status: 'processing',
    requests: Object.fromEntries(
      items.map(item => [item.customId, {
        type: 'explainer' as const,
        input: item.input,
        source: item.source,
        output: null,
        result: 'pending' as const,
        error: null,
        focusHint: item.focusHint,
        imageOverride: item.imageOverride,
      } satisfies RequestState])
    ),
  };
}

async function submitOpenAIBatch(items: InputItem[]): Promise<BatchState> {
  const modelConfig = getModelConfig('openai');
  const client = getOpenAIClient();
  const submittedAt = new Date().toISOString();
  const expectedDate = dateFromIso(submittedAt);
  const lanesEnabled = useOpenAILanes();
  const requests: Record<string, RequestState> = {};
  for (const item of items) {
    requests[item.customId] = {
      type: 'explainer',
      input: item.input,
      source: item.source,
      output: null,
      result: 'pending',
      error: null,
      focusHint: item.focusHint,
      imageOverride: item.imageOverride,
    };
    if (lanesEnabled) {
      for (const lane of OPENAI_LANES) {
        requests[laneCustomId(item.customId, lane)] = {
          type: 'lane',
          lane,
          input: item.input,
          source: item.source,
          output: null,
          result: 'pending',
          error: null,
          focusHint: item.focusHint,
          imageOverride: item.imageOverride,
        };
      }
    }
  }
  const authMode = client.authMode();
  if (authMode === 'api_key') {
    const state = readState();
    const fileCache = state.openai_file_cache ?? {};
    let fileCacheChanged = false;
    const uploadedFileIds = new Map<string, string | null>();
    for (const item of items) {
      if (item.isUrl) {
        uploadedFileIds.set(item.customId, null);
        continue;
      }
      const filePath = item.filePath ?? path.join(__dirname, '..', 'input', item.input);
      const buffer = fs.readFileSync(filePath);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const cacheKey = item.input;
      const cached = fileCache[cacheKey];

      let fileId: string;
      if (cached && cached.sha256 === sha256 && await client.fileExists(cached.file_id)) {
        fileId = cached.file_id;
        console.log(`  ↺ Reusing OpenAI file: ${item.input} (${fileId})`);
      } else {
        fileId = await client.uploadFile(buffer, path.basename(filePath), 'user_data');
        const sizeBytes = fs.statSync(filePath).size;
        fileCache[cacheKey] = {
          file_id: fileId,
          sha256,
          size_bytes: sizeBytes,
          updated_at: new Date().toISOString(),
        };
        fileCacheChanged = true;
      }
      uploadedFileIds.set(item.customId, fileId);
    }
    if (fileCacheChanged) {
      state.openai_file_cache = fileCache;
      writeState(state);
    }

    const lines: string[] = [];
    for (const item of items) {
      const userInstruction = buildUserInstruction(expectedDate, item.focusHint);
      if (lanesEnabled) {
        for (const lane of OPENAI_LANES) {
          const customId = laneCustomId(item.customId, lane);
          const body = {
            model: modelConfig.laneModel,
            max_output_tokens: modelConfig.laneMaxTokens,
            instructions: laneInstruction(lane),
            input: [{ role: 'user' as const, content: buildOpenAIInput(item, uploadedFileIds.get(item.customId) ?? null, userInstruction, lane) }],
          };
          lines.push(JSON.stringify({
            custom_id: customId,
            method: 'POST',
            url: '/v1/responses',
            body,
          }));
        }
      } else {
        lines.push(JSON.stringify({
          custom_id: item.customId,
          method: 'POST',
          url: '/v1/responses',
          body: {
            model: modelConfig.synthesisModel,
            max_output_tokens: modelConfig.synthesisMaxTokens,
            instructions: buildSystemPrompt(),
            input: [{ role: 'user' as const, content: buildOpenAIInput(item, uploadedFileIds.get(item.customId) ?? null, userInstruction) }],
          },
        }));
      }
    }

    if (lanesEnabled) {
      console.log(`  Submitting OpenAI lane batch: ${items.length} paper(s) × ${OPENAI_LANES.length} lanes using ${modelConfig.laneModel}…`);
    } else {
      console.log(`  Submitting OpenAI single-stage batch: ${items.length} paper(s) using ${modelConfig.synthesisModel}…`);
    }
    const inputFileId = await client.uploadJsonl(lines.join('\n'));
    const batch = await client.createBatch(inputFileId);
    console.log(`  ✓ Batch submitted: ${batch.id}`);
    console.log(`    Processing status: ${batch.status}`);

    return {
      id: batch.id,
      provider: 'openai',
      model: lanesEnabled ? modelConfig.laneModel : modelConfig.synthesisModel,
      lane_model: lanesEnabled ? modelConfig.laneModel : undefined,
      synthesis_model: modelConfig.synthesisModel,
      submitted_at: submittedAt,
      status: 'processing',
      requests,
    };
  }

  if (authMode === 'codex_cli') {
    const localBatchId = `codexbatch_${Date.now()}`;
    console.log(`  OpenAI API key not found; using codex auth local batch mode (${localBatchId}).`);
    console.log('  Run "npm run poll -- --provider openai <batch-id>" to execute lane extraction and synthesis.');
    return {
      id: localBatchId,
      provider: 'openai',
      model: lanesEnabled ? modelConfig.laneModel : modelConfig.synthesisModel,
      lane_model: lanesEnabled ? modelConfig.laneModel : undefined,
      synthesis_model: modelConfig.synthesisModel,
      submitted_at: submittedAt,
      status: 'processing',
      requests,
    };
  }

  throw new Error('OpenAI auth not configured. Set OPENAI_API_KEY or log in with codex chatgpt auth.');
}

export async function submitBatch(provider: ProviderName, items: InputItem[]): Promise<string> {
  const batchState = provider === 'claude'
    ? await submitClaudeBatch(items)
    : await submitOpenAIBatch(items);

  const state = readState();
  addBatch(state, batchState);
  writeState(state);
  writeJobFile(batchState, items);
  return batchState.id;
}

async function pollBatchStatus(provider: ProviderName, batchId: string) {
  if (provider === 'claude') {
    const client = getClaudeClient();
    return client.retrieveBatch(batchId);
  }
  const client = getOpenAIClient();
  return client.retrieveBatch(batchId);
}

async function collectClaude(batchState: BatchState): Promise<void> {
  const modelConfig = getModelConfig('claude');
  const client = getClaudeClient();
  const freshState = readState();
  const freshBatch = getBatchById(freshState, batchState.id);
  if (!freshBatch) return;
  freshBatch.status = 'ended';
  const savedResults: SaveResult[] = [];
  const expectedDate = dateFromIso(freshBatch.submitted_at);

  for await (const entry of client.iterateBatchResults(batchState.id)) {
    const req = freshBatch.requests[entry.customId];
    if (!req) continue;

    if (entry.type === 'errored') {
      req.result = 'errored';
      req.error = entry.error ?? 'Unknown error';
      console.error(`  ✗ ${entry.customId} — ${req.error}`);
      continue;
    }

    try {
      const repaired = await maybeRepairClaude(
        client,
        'api_key',
        modelConfig.repairModel,
        modelConfig.repairMaxTokens,
        entry.text ?? '',
        expectedDate
      );
      const saved = await saveResult(entry.customId, repaired.html);
      savedResults.push(saved);

      req.result = 'succeeded';
      req.output = saved.jsonFile;
      req.error = null;
      applyUsage(
        req,
        'claude',
        freshBatch.model || modelConfig.batchModel,
        entry.inputTokens ?? 0,
        entry.outputTokens ?? 0,
        true,
        modelConfig.repairModel,
        repaired.usage
      );

      console.log(
        `  ✓ ${entry.customId} → ${saved.jsonFile}` +
        `  [${(req.usage?.input_tokens ?? 0).toLocaleString()} in / ${(req.usage?.output_tokens ?? 0).toLocaleString()} out` +
        `  batch: ${formatUsd(req.usage?.batch_cost_usd ?? 0)}  saved: ${formatUsd(req.usage?.saving_usd ?? 0)}]`
      );
    } catch (error) {
      req.result = 'errored';
      req.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${entry.customId} — ${req.error}`);
    }
  }

  writeState(freshState);
  await exportSavedHtml(savedResults);
}

async function collectOpenAI(batchState: BatchState): Promise<void> {
  const modelConfig = getModelConfig('openai');
  const client = getOpenAIClient();
  client.requireBatchAuth();

  const freshState = readState();
  const freshBatch = getBatchById(freshState, batchState.id);
  if (!freshBatch) return;
  freshBatch.status = 'ended';
  const lanesPresent = Object.values(freshBatch.requests).some(r => r.type === 'lane');
  const savedResults: SaveResult[] = [];
  const expectedDate = dateFromIso(freshBatch.submitted_at);

  if (!lanesPresent) {
    for await (const entry of client.iterateBatchResults(batchState.id)) {
      const req = freshBatch.requests[entry.customId];
      if (!req || req.type !== 'explainer') continue;
      if (entry.type === 'errored') {
        req.result = 'errored';
        req.error = entry.error ?? 'Unknown error';
        console.error(`  ✗ ${entry.customId} — ${req.error}`);
        continue;
      }

      try {
        const repaired = await maybeRepairOpenAI(
          client,
          modelConfig.repairModel,
          modelConfig.repairMaxTokens,
          entry.text ?? '',
          expectedDate
        );
        const saved = await saveResult(entry.customId, repaired.html);
        savedResults.push(saved);
        req.result = 'succeeded';
        req.output = saved.jsonFile;
        req.error = null;
        applyUsage(
          req,
          'openai',
          freshBatch.synthesis_model ?? modelConfig.synthesisModel,
          entry.inputTokens ?? 0,
          entry.outputTokens ?? 0,
          true,
          modelConfig.repairModel,
          repaired.usage
        );
        console.log(
          `  ✓ ${entry.customId} → ${saved.jsonFile}` +
          `  [${(req.usage?.input_tokens ?? 0).toLocaleString()} in / ${(req.usage?.output_tokens ?? 0).toLocaleString()} out` +
          `  cost: ${formatUsd(req.usage?.batch_cost_usd ?? 0)}]`
        );
      } catch (error) {
        req.result = 'errored';
        req.error = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ ${entry.customId} — ${req.error}`);
      }
    }
    writeState(freshState);
    await exportSavedHtml(savedResults);
    return;
  }

  const laneTextByPaper = new Map<string, Partial<Record<OpenAILane, string>>>();

  for await (const entry of client.iterateBatchResults(batchState.id)) {
    const req = freshBatch.requests[entry.customId];
    if (!req) continue;

    if (entry.type === 'errored') {
      req.result = 'errored';
      req.error = entry.error ?? 'Unknown error';
      console.error(`  ✗ ${entry.customId} — ${req.error}`);
      continue;
    }

    req.result = 'succeeded';
    applyUsage(
      req,
      'openai',
      freshBatch.lane_model ?? freshBatch.model ?? modelConfig.laneModel,
      entry.inputTokens ?? 0,
      entry.outputTokens ?? 0,
      true,
      modelConfig.repairModel,
      undefined
    );

    const parsed = parseLaneCustomId(entry.customId);
    if (parsed) {
      const current = laneTextByPaper.get(parsed.baseCustomId) ?? {};
      current[parsed.lane] = entry.text ?? '';
      laneTextByPaper.set(parsed.baseCustomId, current);
    }
  }

  const systemPrompt = buildSystemPrompt();
  const synthesisModel = freshBatch.synthesis_model ?? modelConfig.synthesisModel;
  const synthesisLines: string[] = [];

  for (const [customId, req] of Object.entries(freshBatch.requests)) {
    if (req.type !== 'explainer') continue;

    const laneMap = laneTextByPaper.get(customId);
    if (!laneMap) {
      req.result = 'errored';
      req.error = 'No lane outputs available for synthesis';
      continue;
    }

    const laneBody = OPENAI_LANES
      .map(lane => `## ${lane}\n${laneMap[lane] ?? '(missing)'}`)
      .join('\n\n');

    const userInstruction = buildUserInstruction(expectedDate, req.focusHint);

    synthesisLines.push(JSON.stringify({
      custom_id: customId,
      method: 'POST',
      url: '/v1/responses',
      body: {
        model: synthesisModel,
        max_output_tokens: modelConfig.synthesisMaxTokens,
        instructions: systemPrompt,
        input: [{
          role: 'user' as const,
          content: [{ type: 'input_text', text: `${userInstruction}\n\nUse these extracted lane notes as your factual substrate:\n\n${laneBody}` }],
        }],
      },
    }));
  }

  if (synthesisLines.length === 0) {
    writeState(freshState);
    return;
  }

  const synthInputFileId = await client.uploadJsonl(synthesisLines.join('\n'));
  const synthBatch = await client.createBatch(synthInputFileId);
  console.log(`  Submitted OpenAI synthesis batch: ${synthBatch.id} (${synthesisLines.length} request(s), model: ${synthesisModel})`);

  console.log(`  Waiting ${Math.round(POLL_SYNTH_INITIAL_WAIT_MS / 1000)}s before first synthesis poll…`);
  await new Promise(r => setTimeout(r, POLL_SYNTH_INITIAL_WAIT_MS));
  while (true) {
    const synthStatus = await client.retrieveBatch(synthBatch.id);
    const counts = synthStatus.counts;
    console.log(`  Synthesis status: ${synthStatus.status} — processing: ${counts.processing}, succeeded: ${counts.succeeded}, errored: ${counts.errored}`);
    if (synthStatus.status === 'ended') break;
    console.log(`  Next synthesis poll in ${Math.round(POLL_INTERVAL_MS / 1000)}s…`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  for await (const entry of client.iterateBatchResults(synthBatch.id)) {
    const req = freshBatch.requests[entry.customId];
    if (!req || req.type !== 'explainer') continue;

    if (entry.type === 'errored') {
      req.result = 'errored';
      req.error = entry.error ?? 'Unknown synthesis error';
      console.error(`  ✗ ${entry.customId} — ${req.error}`);
      continue;
    }

    try {
      const repaired = await maybeRepairOpenAI(
        client,
        modelConfig.repairModel,
        modelConfig.repairMaxTokens,
        entry.text ?? '',
        expectedDate
      );
      const saved = await saveResult(entry.customId, repaired.html);
      savedResults.push(saved);
      req.result = 'succeeded';
      req.output = saved.jsonFile;
      req.error = null;

      applyUsage(
        req,
        'openai',
        synthesisModel,
        entry.inputTokens ?? 0,
        entry.outputTokens ?? 0,
        true,
        modelConfig.repairModel,
        repaired.usage
      );

      console.log(
        `  ✓ ${entry.customId} → ${saved.jsonFile}` +
        `  [${(req.usage?.input_tokens ?? 0).toLocaleString()} in / ${(req.usage?.output_tokens ?? 0).toLocaleString()} out` +
        `  cost: ${formatUsd(req.usage?.batch_cost_usd ?? 0)}]`
      );
    } catch (error) {
      req.result = 'errored';
      req.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${entry.customId} — ${req.error}`);
    }
  }

  writeState(freshState);
  await exportSavedHtml(savedResults);
}

async function collectOpenAILocal(batchState: BatchState): Promise<void> {
  const modelConfig = getModelConfig('openai');
  const client = getOpenAIClient();
  const freshState = readState();
  const freshBatch = getBatchById(freshState, batchState.id);
  if (!freshBatch) return;
  freshBatch.status = 'ended';
  const lanesPresent = Object.values(freshBatch.requests).some(r => r.type === 'lane');
  const savedResults: SaveResult[] = [];

  const systemPrompt = buildSystemPrompt();
  const expectedDate = dateFromIso(freshBatch.submitted_at);
  for (const [customId, req] of Object.entries(freshBatch.requests)) {
    if (req.type !== 'explainer') continue;
    const item = requestToInputItem(customId, req);
    const userInstruction = buildUserInstruction(expectedDate, item.focusHint);

    try {
      let synthesis: ProviderMessageResponse;
      if (lanesPresent) {
        const laneMap: Partial<Record<OpenAILane, string>> = {};
        for (const lane of OPENAI_LANES) {
          const laneId = laneCustomId(customId, lane);
          const laneReq = freshBatch.requests[laneId];
          if (!laneReq) continue;

          try {
            const laneResp = await client.createMessage(
              freshBatch.lane_model ?? modelConfig.laneModel,
              modelConfig.laneMaxTokens,
              laneInstruction(lane),
              [{
                role: 'user',
                content: buildOpenAIInput(item, null, userInstruction, lane),
              }],
              item.isUrl
            );

            laneReq.result = 'succeeded';
            laneReq.error = null;
            applyUsage(
              laneReq,
              'openai',
              freshBatch.lane_model ?? modelConfig.laneModel,
              laneResp.inputTokens,
              laneResp.outputTokens,
              false,
              modelConfig.repairModel,
              undefined
            );
            laneMap[lane] = laneResp.text;
          } catch (error) {
            laneReq.result = 'errored';
            laneReq.error = error instanceof Error ? error.message : String(error);
            console.error(`  ✗ ${laneId} — ${laneReq.error}`);
          }
        }

        const laneBody = OPENAI_LANES
          .map(lane => `## ${lane}\n${laneMap[lane] ?? '(missing)'}`)
          .join('\n\n');

        synthesis = await client.createMessage(
          freshBatch.synthesis_model ?? modelConfig.synthesisModel,
          modelConfig.synthesisMaxTokens,
          systemPrompt,
          [{
            role: 'user',
            content: [{ type: 'input_text', text: `${userInstruction}\n\nUse these extracted lane notes as your factual substrate:\n\n${laneBody}` }],
          }]
        );
      } else {
        synthesis = await client.createMessage(
          freshBatch.synthesis_model ?? modelConfig.synthesisModel,
          modelConfig.synthesisMaxTokens,
          systemPrompt,
          [{
            role: 'user',
            content: buildOpenAIInput(item, null, userInstruction),
          }],
          item.isUrl
        );
      }

      const repaired = await maybeRepairOpenAI(
        client,
        modelConfig.repairModel,
        modelConfig.repairMaxTokens,
        synthesis.text,
        expectedDate
      );

      const saved = await saveResult(customId, repaired.html);
      savedResults.push(saved);
      req.result = 'succeeded';
      req.output = saved.jsonFile;
      req.error = null;

      applyUsage(
        req,
        'openai',
        freshBatch.synthesis_model ?? modelConfig.synthesisModel,
        synthesis.inputTokens,
        synthesis.outputTokens,
        false,
        modelConfig.repairModel,
        repaired.usage
      );

      console.log(
        `  ✓ ${customId} → ${saved.jsonFile}` +
        `  [${(req.usage?.input_tokens ?? 0).toLocaleString()} in / ${(req.usage?.output_tokens ?? 0).toLocaleString()} out` +
        `  cost: ${formatUsd(req.usage?.batch_cost_usd ?? 0)}]`
      );
    } catch (error) {
      req.result = 'errored';
      req.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${customId} — ${req.error}`);
    }
  }

  writeState(freshState);
  await exportSavedHtml(savedResults);
}

function buildClaudeCliPrompt(item: InputItem, userInstruction: string): string {
  if (item.isUrl) {
    if (item.htmlContent) {
      return `Source URL: ${item.source.url ?? item.input}\n\nExtracted page text:\n${item.htmlContent}\n\n${userInstruction}`;
    }
    return `The paper is at: ${item.source.url ?? item.input}\n\n${userInstruction}`;
  }
  const absPath = item.filePath ?? path.join(__dirname, '..', 'input', item.input);
  return `Read the PDF at this path: ${absPath}\n\n${userInstruction}`;
}

async function runClaudeSync(batchId: string, items: InputItem[]): Promise<void> {
  const modelConfig = getModelConfig('claude');
  const authMode = detectClaudeAuthMode(true);
  const client = getClaudeClient();
  const freshState = readState();
  const freshBatch = getBatchById(freshState, batchId);
  if (!freshBatch) return;
  const savedResults: SaveResult[] = [];
  const expectedDate = dateFromIso(freshBatch.submitted_at);

  if (authMode === 'claude_cli') {
    console.log(`  Using Claude max-plan route (CLAUDE_CODE_OAUTH_TOKEN) — no API credits consumed`);
  }

  for (const item of items) {
    const req = freshBatch.requests[item.customId];
    if (!req) continue;
    const userInstruction = buildUserInstruction(expectedDate, item.focusHint);
    try {
      let response: ProviderMessageResponse;
      if (authMode === 'claude_cli') {
        const prompt = buildClaudeCliPrompt(item, userInstruction);
        response = await client.createMessageViaCli(
          modelConfig.synthesisModel,
          buildSystemPrompt(),
          prompt
        );
      } else {
        response = await client.createMessageWithContent(
          modelConfig.synthesisModel,
          modelConfig.synthesisMaxTokens,
          buildSystemPrompt(),
          buildClaudeRequestContent(item, userInstruction)
        );
      }
      const repaired = await maybeRepairClaude(
        client,
        authMode,
        modelConfig.repairModel,
        modelConfig.repairMaxTokens,
        response.text,
        expectedDate
      );
      const saved = await saveResult(item.customId, repaired.html);
      savedResults.push(saved);
      req.result = 'succeeded';
      req.output = saved.jsonFile;
      req.error = null;
      applyUsage(
        req,
        'claude',
        modelConfig.synthesisModel,
        response.inputTokens,
        response.outputTokens,
        false,
        modelConfig.repairModel,
        repaired.usage
      );
      console.log(
        `  ✓ ${item.customId} → ${saved.jsonFile}` +
        `  [${(req.usage?.input_tokens ?? 0).toLocaleString()} in / ${(req.usage?.output_tokens ?? 0).toLocaleString()} out` +
        `  cost: ${formatUsd(req.usage?.batch_cost_usd ?? 0)}]`
      );
    } catch (error) {
      req.result = 'errored';
      req.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${item.customId} — ${req.error}`);
    }
  }

  freshBatch.status = 'ended';
  writeState(freshState);
  await exportSavedHtml(savedResults);
}

async function runOpenAISync(batchId: string, items: InputItem[]): Promise<void> {
  const modelConfig = getModelConfig('openai');
  const client = getOpenAIClient();
  const mode = client.authMode();
  if (mode === 'none') {
    throw new Error('OpenAI auth not configured. Set OPENAI_API_KEY or log in with codex chatgpt auth.');
  }

  const lanesEnabled = useOpenAILanes();
  const uploadedFileIds = new Map<string, string | null>();

  if (mode === 'api_key') {
    const state = readState();
    const fileCache = state.openai_file_cache ?? {};
    let fileCacheChanged = false;

    for (const item of items) {
      if (item.isUrl) {
        uploadedFileIds.set(item.customId, null);
        continue;
      }
      const filePath = item.filePath ?? path.join(__dirname, '..', 'input', item.input);
      const buffer = fs.readFileSync(filePath);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const cacheKey = item.input;
      const cached = fileCache[cacheKey];

      let fileId: string;
      if (cached && cached.sha256 === sha256 && await client.fileExists(cached.file_id)) {
        fileId = cached.file_id;
      } else {
        fileId = await client.uploadFile(buffer, path.basename(filePath), 'user_data');
        const sizeBytes = fs.statSync(filePath).size;
        fileCache[cacheKey] = {
          file_id: fileId,
          sha256,
          size_bytes: sizeBytes,
          updated_at: new Date().toISOString(),
        };
        fileCacheChanged = true;
      }
      uploadedFileIds.set(item.customId, fileId);
    }

    if (fileCacheChanged) {
      state.openai_file_cache = fileCache;
      writeState(state);
    }
  } else {
    for (const item of items) uploadedFileIds.set(item.customId, null);
  }

  const freshState = readState();
  const freshBatch = getBatchById(freshState, batchId);
  if (!freshBatch) return;
  const systemPrompt = buildSystemPrompt();
  const expectedDate = dateFromIso(freshBatch.submitted_at);
  const savedResults: SaveResult[] = [];

  for (const item of items) {
    const req = freshBatch.requests[item.customId];
    if (!req) continue;
    const userInstruction = buildUserInstruction(expectedDate, item.focusHint);

    try {
      let synthesis: ProviderMessageResponse;
      if (lanesEnabled) {
        const laneMap: Partial<Record<OpenAILane, string>> = {};
        for (const lane of OPENAI_LANES) {
          const laneId = laneCustomId(item.customId, lane);
          const laneReq = freshBatch.requests[laneId];
          if (!laneReq) continue;

          try {
            const laneResp = await client.createMessage(
              freshBatch.lane_model ?? modelConfig.laneModel,
              modelConfig.laneMaxTokens,
              laneInstruction(lane),
              [{
                role: 'user',
                content: buildOpenAIInput(item, uploadedFileIds.get(item.customId) ?? null, userInstruction, lane),
              }],
              mode === 'codex_cli' && item.isUrl
            );

            laneReq.result = 'succeeded';
            laneReq.error = null;
            applyUsage(
              laneReq,
              'openai',
              freshBatch.lane_model ?? modelConfig.laneModel,
              laneResp.inputTokens,
              laneResp.outputTokens,
              false,
              modelConfig.repairModel,
              undefined
            );
            laneMap[lane] = laneResp.text;
          } catch (error) {
            laneReq.result = 'errored';
            laneReq.error = error instanceof Error ? error.message : String(error);
            console.error(`  ✗ ${laneId} — ${laneReq.error}`);
          }
        }

        const laneBody = OPENAI_LANES
          .map(lane => `## ${lane}\n${laneMap[lane] ?? '(missing)'}`)
          .join('\n\n');

        synthesis = await client.createMessage(
          freshBatch.synthesis_model ?? modelConfig.synthesisModel,
          modelConfig.synthesisMaxTokens,
          systemPrompt,
          [{
            role: 'user',
            content: [{ type: 'input_text', text: `${userInstruction}\n\nUse these extracted lane notes as your factual substrate:\n\n${laneBody}` }],
          }]
        );
      } else {
        synthesis = await client.createMessage(
          freshBatch.synthesis_model ?? modelConfig.synthesisModel,
          modelConfig.synthesisMaxTokens,
          systemPrompt,
          [{
            role: 'user',
            content: buildOpenAIInput(item, uploadedFileIds.get(item.customId) ?? null, userInstruction),
          }],
          mode === 'codex_cli' && item.isUrl
        );
      }

      const repaired = await maybeRepairOpenAI(
        client,
        modelConfig.repairModel,
        modelConfig.repairMaxTokens,
        synthesis.text,
        expectedDate
      );

      const saved = await saveResult(item.customId, repaired.html);
      savedResults.push(saved);
      req.result = 'succeeded';
      req.output = saved.jsonFile;
      req.error = null;
      applyUsage(
        req,
        'openai',
        freshBatch.synthesis_model ?? modelConfig.synthesisModel,
        synthesis.inputTokens,
        synthesis.outputTokens,
        false,
        modelConfig.repairModel,
        repaired.usage
      );

      console.log(
        `  ✓ ${item.customId} → ${saved.jsonFile}` +
        `  [${(req.usage?.input_tokens ?? 0).toLocaleString()} in / ${(req.usage?.output_tokens ?? 0).toLocaleString()} out` +
        `  cost: ${formatUsd(req.usage?.batch_cost_usd ?? 0)}]`
      );
    } catch (error) {
      req.result = 'errored';
      req.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${item.customId} — ${req.error}`);
    }
  }

  freshBatch.status = 'ended';
  writeState(freshState);
  await exportSavedHtml(savedResults);
}

export async function runSync(provider: ProviderName, items: InputItem[]): Promise<string> {
  const claudeModels = getModelConfig('claude');
  const openaiModels = getModelConfig('openai');
  const lanesEnabled = useOpenAILanes();
  const id = `sync_${provider}_${Date.now()}`;
  const batchState: BatchState = {
    id,
    provider,
    model: provider === 'openai'
      ? (lanesEnabled ? openaiModels.laneModel : openaiModels.synthesisModel)
      : claudeModels.synthesisModel,
    lane_model: provider === 'openai' && lanesEnabled ? openaiModels.laneModel : undefined,
    synthesis_model: provider === 'openai' ? openaiModels.synthesisModel : claudeModels.synthesisModel,
    submitted_at: new Date().toISOString(),
    status: 'processing',
    requests: {},
  };

  for (const item of items) {
    batchState.requests[item.customId] = {
      type: 'explainer',
      input: item.input,
      source: item.source,
      output: null,
      result: 'pending',
      error: null,
    };
    if (provider === 'openai' && lanesEnabled) {
      for (const lane of OPENAI_LANES) {
        batchState.requests[laneCustomId(item.customId, lane)] = {
          type: 'lane',
          lane,
          input: item.input,
          source: item.source,
          output: null,
          result: 'pending',
          error: null,
        };
      }
    }
  }

  const state = readState();
  addBatch(state, batchState);
  writeState(state);

  if (provider === 'claude') {
    await runClaudeSync(id, items);
  } else {
    await runOpenAISync(id, items);
  }

  const refreshed = readState();
  const doneBatch = getBatchById(refreshed, id);
  if (doneBatch) printBatchCostSummary(doneBatch);
  return id;
}

function printBatchCostSummary(batch: BatchState): void {
  const reqs = Object.values(batch.requests).filter(r => r.usage);
  if (reqs.length === 0) return;
  const totalBatch = reqs.reduce((s, r) => s + (r.usage?.batch_cost_usd ?? 0), 0);
  const totalStandard = reqs.reduce((s, r) => s + (r.usage?.standard_cost_usd ?? 0), 0);
  const totalSaving = reqs.reduce((s, r) => s + (r.usage?.saving_usd ?? 0), 0);
  console.log(`\n  Cost: ${formatUsd(totalBatch)} (effective) — saved ${formatUsd(totalSaving)} vs standard ${formatUsd(totalStandard)} — up to ${Math.round(BATCH_DISCOUNT * 100)}% batch discount where applicable`);
}

export async function pollAndRetrieve(provider: ProviderName, batchId?: string): Promise<void> {
  const state = readState();
  const batchState = batchId
    ? getBatchById(state, batchId)
    : getLatestPendingBatchByProvider(state, provider);

  if (!batchState) {
    console.log('No pending batch found.');
    return;
  }

  const batchProvider = batchState.provider ?? 'claude';
  console.log(`  Polling batch ${batchState.id} (${batchProvider})…`);

  const isLocalOpenAIBatch = batchProvider === 'openai' && batchState.id.startsWith('codexbatch_');
  if (isLocalOpenAIBatch) {
    console.log('  Status: local_pending — processing: 1, succeeded: 0, errored: 0');
    console.log('  Executing local OpenAI/Codex lane extraction and synthesis…');
    await collectOpenAILocal(batchState);
    const refreshed = readState();
    const doneBatch = getBatchById(refreshed, batchState.id);
    if (doneBatch) printBatchCostSummary(doneBatch);
    removeJobFile(batchState.id);
    console.log('  Done.');
    return;
  }

  console.log(`  Waiting ${Math.round(POLL_INITIAL_WAIT_MS / 1000)}s before first poll…`);
  await new Promise(r => setTimeout(r, POLL_INITIAL_WAIT_MS));
  while (true) {
    const batch = await pollBatchStatus(batchProvider, batchState.id);
    const counts = batch.counts;
    console.log(`  Status: ${batch.status} — processing: ${counts.processing}, succeeded: ${counts.succeeded}, errored: ${counts.errored}`);
    if (batch.status === 'ended') break;
    console.log(`  Next poll in ${Math.round(POLL_INTERVAL_MS / 1000)}s…`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.log('  Batch complete. Retrieving results…');

  if (batchProvider === 'claude') {
    await collectClaude(batchState);
  } else {
    await collectOpenAI(batchState);
  }

  const refreshed = readState();
  const doneBatch = getBatchById(refreshed, batchState.id);
  if (doneBatch) printBatchCostSummary(doneBatch);
  removeJobFile(batchState.id);
  console.log('  Done.');
}

export function printStatus(providerFilter?: ProviderName): void {
  const state = readState();
  if (state.batches.length === 0) {
    console.log('No batches recorded in state.json');
    return;
  }

  let grandIn = 0;
  let grandOut = 0;
  let grandBatchCost = 0;
  let grandStdCost = 0;
  let shown = 0;

  for (const batch of [...state.batches].reverse()) {
    const provider = batch.provider ?? 'claude';
    if (providerFilter && provider !== providerFilter) continue;
    shown += 1;

    const allReqs = Object.values(batch.requests);
    const explainers = allReqs.filter(r => r.type === 'explainer');
    const lanes = allReqs.filter(r => r.type === 'lane');
    const total = explainers.length;
    const done = explainers.filter(r => r.result === 'succeeded').length;
    const errored = explainers.filter(r => r.result === 'errored').length;

    const batchIn = allReqs.reduce((s, r) => s + (r.usage?.input_tokens ?? 0), 0);
    const batchOut = allReqs.reduce((s, r) => s + (r.usage?.output_tokens ?? 0), 0);
    const batchCost = allReqs.reduce((s, r) => s + (r.usage?.batch_cost_usd ?? 0), 0);
    const standardCost = allReqs.reduce((s, r) => s + (r.usage?.standard_cost_usd ?? 0), 0);
    const saving = allReqs.reduce((s, r) => s + (r.usage?.saving_usd ?? 0), 0);

    grandIn += batchIn;
    grandOut += batchOut;
    grandBatchCost += batchCost;
    grandStdCost += standardCost;

    console.log(`\n${batch.id}  [${batch.status}]  provider: ${provider}  model: ${batch.model ?? '?'}  submitted: ${batch.submitted_at}`);
    console.log(`  Explainers: ${total} total, ${done} succeeded, ${errored} errored${lanes.length > 0 ? `  |  lanes: ${lanes.length}` : ''}`);

    if (batchIn > 0) {
      console.log(`  Tokens:   ${batchIn.toLocaleString()} input + ${batchOut.toLocaleString()} output`);
      console.log(`  Cost:     ${formatUsd(batchCost)} (effective)  |  ${formatUsd(standardCost)} (standard)  |  saved ${formatUsd(saving)}`);
    }

    for (const req of explainers) {
      const tag = req.result === 'succeeded' ? '✓' : req.result === 'errored' ? '✗' : '…';
      const out = req.output ? ` → ${path.basename(req.output)}` : '';
      const tokens = req.usage
        ? `  [${req.usage.input_tokens.toLocaleString()}+${req.usage.output_tokens.toLocaleString()} tok  ${formatUsd(req.usage.batch_cost_usd)}]`
        : '';
      console.log(`    ${tag} ${req.input}${out}${tokens}`);
    }
  }

  if (grandBatchCost > 0) {
    const grandSaving = grandStdCost - grandBatchCost;
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`All-time: ${grandIn.toLocaleString()} in + ${grandOut.toLocaleString()} out tokens`);
    console.log(`          ${formatUsd(grandBatchCost)} spent (effective)  |  ${formatUsd(grandStdCost)} (standard)  |  ${formatUsd(grandSaving)} saved`);
  }

  if (shown === 0) {
    console.log(`No batches recorded for provider "${providerFilter}"`);
  }
}
