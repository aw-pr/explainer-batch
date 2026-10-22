import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import {
  readState, mergeBatch, mergeOpenAIFileCache, getBatchById, getLatestPendingBatchByProvider,
  type BatchState, type RequestState,
} from './state';
import { buildSystemPrompt, buildUserInstruction } from './prompt';
import { saveRawOutput, OUTPUT_DIR } from './output';
import { finalizeResult, type FinalizeContext } from './finalize';
import type { NormalizedResult, TokenUsage } from './llm-contract';
import { exportHtmlForJsonFiles } from './html-export';
import { calcCost, formatUsd, BATCH_DISCOUNT } from './pricing';
import { getModelConfig, OPENAI_LANES, laneCustomId, parseLaneCustomId, type OpenAILane } from './model-config';
import type { InputItem } from './preprocess';
import { ClaudeProvider, OpenAIProvider, detectClaudeAuthMode, isFatalHttpError, openAIJsonSchemaFormat, type ClaudeAuthMode, type ProviderName, type ProviderMessageResponse, type ProviderBatchStatus } from './providers';
import { wireSchema, structuredOutputEnabled } from './wire-schema';

// Optional shared batch-dashboard integration. Defaults to `<repo>/jobs`;
// override with EXPLAINER_JOBS_DIR. Job-file writes are best-effort: if the
// directory cannot be created/written (e.g. not using the dashboard), the
// pipeline continues unaffected.
const JOBS_DIR = process.env.EXPLAINER_JOBS_DIR
  ? path.resolve(process.env.EXPLAINER_JOBS_DIR)
  : path.join(__dirname, '..', 'jobs');

// Polling: check once immediately (a re-poll of a finished batch should not
// wait), then a longer initial window, then every 30s. Providers allow up to
// 24h per batch; the total budget stops a stuck loop holding a terminal
// forever - the batch id stays in state.json, so polling can simply re-run.
const POLL_INITIAL_WAIT_MS = 3 * 60_000;
const POLL_INTERVAL_MS = 30_000;
const POLL_SYNTH_INITIAL_WAIT_MS = 90_000; // synthesis batches are smaller/faster
const POLL_MAX_TOTAL_MS = 12 * 60 * 60_000;
const POLL_MAX_CONSECUTIVE_ERRORS = 5;
const POLL_ERROR_BACKOFF_CAP_MS = 8 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function pollUntilEnded(
  label: string,
  initialWaitMs: number,
  fetchStatus: () => Promise<ProviderBatchStatus>,
): Promise<void> {
  const startedAt = Date.now();
  let consecutiveErrors = 0;
  let checkedOnce = false;

  while (true) {
    if (Date.now() - startedAt > POLL_MAX_TOTAL_MS) {
      throw new Error(
        `${label} polling gave up after ${Math.round(POLL_MAX_TOTAL_MS / 3_600_000)}h; ` +
        're-run poll later to resume (the batch id is saved in state.json).'
      );
    }

    try {
      const snapshot = await fetchStatus();
      consecutiveErrors = 0;
      const counts = snapshot.counts;
      console.log(`  ${label} status: ${snapshot.status} (processing: ${counts.processing}, succeeded: ${counts.succeeded}, errored: ${counts.errored})`);
      if (snapshot.status === 'ended') return;
    } catch (error) {
      consecutiveErrors += 1;
      const message = error instanceof Error ? error.message : String(error);
      if (isFatalHttpError(error)) {
        throw new Error(`${label} status polling failed and cannot succeed on retry: ${message}`);
      }
      if (consecutiveErrors > POLL_MAX_CONSECUTIVE_ERRORS) {
        throw new Error(`${label} status polling failed ${consecutiveErrors} times in a row: ${message}`);
      }
      const backoffMs = Math.min(POLL_INTERVAL_MS * 2 ** (consecutiveErrors - 1), POLL_ERROR_BACKOFF_CAP_MS);
      console.warn(`  ${label} status check failed (${consecutiveErrors}/${POLL_MAX_CONSECUTIVE_ERRORS}): ${message}; retrying in ${Math.round(backoffMs / 1000)}s`);
      await sleep(backoffMs);
      continue;
    }

    const waitMs = checkedOnce ? POLL_INTERVAL_MS : initialWaitMs;
    checkedOnce = true;
    console.log(`  Next ${label} poll in ${Math.round(waitMs / 1000)}s…`);
    await sleep(waitMs);
  }
}

function dateFromIso(value: string): string {
  return value.slice(0, 10);
}

async function exportSavedHtml(savedPaths: string[]): Promise<void> {
  const summary = await exportHtmlForJsonFiles(savedPaths);
  if (summary.ok > 0) {
    console.log(`\nHTML export: ${summary.ok} file(s) written to ${path.basename(OUTPUT_DIR)}/`);
  }
  if (summary.failed === 0) return;

  const slugs = summary.failures.map((failure) => path.basename(failure.jsonPath));
  for (const failure of summary.failures) {
    console.error(`  ! HTML export failed for ${path.basename(failure.jsonPath)} — ${failure.error}`);
  }
  // JSON is already saved at this point — the failure must not disappear into
  // the run's console output. Throwing surfaces it as the run's final,
  // non-zero-exit error instead of a silent skip.
  throw new Error(
    `HTML export failed for ${summary.failed} file(s): ${slugs.join(', ')} — see errors above.`,
  );
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
  const raw = process.env.OPENAI_USE_LANES?.toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function missingLanes(laneMap: Partial<Record<OpenAILane, string>> | undefined): OpenAILane[] {
  return OPENAI_LANES.filter(lane => !laneMap || !(lane in laneMap));
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
  } else if (item.isUrl && item.htmlContent) {
    content.push({ type: 'input_text', text: `Page content from ${item.input}:\n\n${item.htmlContent}` });
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
    figureCandidates: req.figureCandidates,
    recreate: req.recreate,
    detectedSurname: req.detectedSurname,
    detectedPublished: req.detectedPublished,
    detectedReference: req.detectedReference,
    detectedCitation: req.detectedCitation,
    publishedOn: req.publishedOn,
  };
}

function provenanceFields(item: InputItem, expectedDate: string): Pick<RequestState, 'expectedDate' | 'detectedSurname' | 'detectedPublished' | 'detectedReference' | 'detectedCitation' | 'publishedOn'> {
  return {
    expectedDate,
    detectedSurname: item.detectedSurname,
    detectedPublished: item.detectedPublished,
    detectedReference: item.detectedReference,
    detectedCitation: item.detectedCitation,
    publishedOn: item.publishedOn,
  };
}

type CompletionMode = 'batch-api' | 'api_key' | 'claude_cli' | 'codex_cli';
type CompletionReceipt = NormalizedResult & { provider: ProviderName; finishReason: 'stop' };

function reportedUsage(response: ProviderMessageResponse): TokenUsage {
  return {
    in: response.inputTokens, out: response.outputTokens,
    cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, source: 'reported',
  };
}

export function buildResultReceipt(
  provider: ProviderName,
  mode: CompletionMode,
  batchId: string,
  customId: string,
  model: string,
  response: ProviderMessageResponse,
): CompletionReceipt {
  return {
    provider,
    route: mode === 'batch-api' ? 'batch-api' : mode === 'api_key' ? 'sync-api' : 'subscription-cli',
    stage: 'synthesis', model, customId, attemptId: `${batchId}:${customId}`,
    finishReason: 'stop', text: response.text, usage: reportedUsage(response),
  };
}

function createRepairAdapter(
  client: ClaudeProvider | OpenAIProvider,
  authMode: ClaudeAuthMode | 'codex_cli',
  repairModel: string,
  repairMaxTokens: number,
): (instruction: string, payload: string) => Promise<ProviderMessageResponse> {
  return async (instruction, payload) => {
    if (client instanceof ClaudeProvider) {
      if (authMode === 'claude_cli') {
        return client.createMessageViaCli(repairModel, instruction, payload);
      }
      return client.createMessage(repairModel, repairMaxTokens, instruction, payload, false, wireSchema('claude'));
    }
    return client.createMessage(
      repairModel, repairMaxTokens, instruction,
      [{ role: 'user', content: [{ type: 'input_text', text: payload }] }],
      false, wireSchema('openai'),
    );
  };
}

async function saveThroughSeam(
  receipt: CompletionReceipt,
  req: RequestState,
  expectedDate: string,
  repairModel: string,
  repair: (instruction: string, payload: string) => Promise<ProviderMessageResponse>,
): Promise<string | null> {
  const checkpoints = new Map<string, unknown>();
  const citation = req.detectedCitation;
  const source = requestToInputItem(receipt.customId, req).source;
  const context: FinalizeContext = {
    stamp: {
      expectedDate: req.expectedDate ?? expectedDate,
      detectedReference: citation ? {
        authors: citation.authors.map(author => ({ family: author.family, given: author.given })),
        year: citation.year, title: citation.title, venue: citation.venue, url: citation.url,
      } : undefined,
      publishedOn: req.publishedOn,
      source: source.kind === 'url'
        ? { kind: 'url', ref: source.url ?? req.input }
        : { kind: 'pdf', ref: path.basename(source.filename ?? source.filePath ?? req.input) },
    },
    checkpoints: { get: key => checkpoints.get(key), put: (key, value) => { checkpoints.set(key, value); } },
    repair: async (instruction, payload) => {
      const response = await repair(instruction, payload);
      return {
        ...receipt, route: receipt.route === 'batch-api' ? 'sync-api' : receipt.route,
        stage: 'repair', model: repairModel, text: response.text, usage: reportedUsage(response),
      };
    },
  };
  const outcome = await finalizeResult(receipt.customId, receipt, context);
  const repairUsage = outcome.receipts.filter(result => result.stage === 'repair').reduce((sum, result) => ({
    text: '', inputTokens: sum.inputTokens + (result.usage.in ?? 0),
    outputTokens: sum.outputTokens + (result.usage.out ?? 0),
  }), { text: '', inputTokens: 0, outputTokens: 0 });
  applyUsage(req, receipt.provider, receipt.model, receipt.usage.in ?? 0, receipt.usage.out ?? 0,
    receipt.route === 'batch-api', repairModel, repairUsage);

  if (outcome.status === 'errored') {
    req.result = 'errored';
    req.output = null;
    req.error = `${outcome.code}: ${outcome.message}`;
    saveRawOutput(receipt.customId, receipt.text);
    console.error(`  ✗ ${receipt.customId}: ${req.error}`);
    return null;
  }
  req.result = 'succeeded';
  req.output = path.relative(OUTPUT_DIR, outcome.jsonPath);
  req.error = null;
  console.log(`  ✓ ${receipt.customId} → ${req.output}`);
  return outcome.status === 'succeeded' ? outcome.jsonPath : null;
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
    content: buildClaudeRequestContent(item, buildUserInstruction(expectedDate, item.focusHint, undefined, item.detectedCitation !== undefined)),
    jsonSchema: wireSchema('claude'),
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
        figureCandidates: item.figureCandidates,
        recreate: item.recreate,
        ...provenanceFields(item, expectedDate),
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
      figureCandidates: item.figureCandidates,
      recreate: item.recreate,
      ...provenanceFields(item, expectedDate),
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
      mergeOpenAIFileCache(fileCache);
    }

    const lines: string[] = [];
    for (const item of items) {
      const userInstruction = buildUserInstruction(expectedDate, item.focusHint, undefined, item.detectedCitation !== undefined);
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
            ...(structuredOutputEnabled()
              ? { text: { format: openAIJsonSchemaFormat(wireSchema('openai')) } }
              : {}),
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

  mergeBatch(batchState);
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
  const savedResults: string[] = [];
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
      const saved = await saveThroughSeam(
        buildResultReceipt('claude', 'batch-api', batchState.id, entry.customId, freshBatch.model || modelConfig.batchModel,
          { text: entry.text ?? '', inputTokens: entry.inputTokens ?? 0, outputTokens: entry.outputTokens ?? 0 }),
        req, expectedDate, modelConfig.repairModel,
        createRepairAdapter(client, 'api_key', modelConfig.repairModel, modelConfig.repairMaxTokens),
      );
      if (saved) savedResults.push(saved);
    } catch (error) {
      req.result = 'errored';
      req.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${entry.customId} — ${req.error}`);
    }
  }

  mergeBatch(freshBatch);
  await exportSavedHtml(savedResults);
}

async function collectOpenAI(batchState: BatchState): Promise<void> {
  const modelConfig = getModelConfig('openai');
  const client = getOpenAIClient();
  client.requireBatchAuth();

  const freshState = readState();
  const freshBatch = getBatchById(freshState, batchState.id);
  if (!freshBatch) return;
  const lanesPresent = Object.values(freshBatch.requests).some(r => r.type === 'lane');
  const savedResults: string[] = [];
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
        const saved = await saveThroughSeam(
          buildResultReceipt('openai', 'batch-api', batchState.id, entry.customId, freshBatch.synthesis_model ?? modelConfig.synthesisModel,
            { text: entry.text ?? '', inputTokens: entry.inputTokens ?? 0, outputTokens: entry.outputTokens ?? 0 }),
          req, expectedDate, modelConfig.repairModel,
          createRepairAdapter(client, 'api_key', modelConfig.repairModel, modelConfig.repairMaxTokens),
        );
        if (saved) savedResults.push(saved);
      } catch (error) {
        req.result = 'errored';
        req.error = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ ${entry.customId} — ${req.error}`);
      }
    }
    freshBatch.status = 'ended';
    mergeBatch(freshBatch);
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
    const missing = missingLanes(laneMap);
    if (missing.length > 0) {
      req.result = 'errored';
      req.error = `Lane(s) failed: ${missing.join(', ')}`;
      continue;
    }

    const laneBody = OPENAI_LANES
      .map(lane => `## ${lane}\n${laneMap![lane]}`)
      .join('\n\n');

    const userInstruction = buildUserInstruction(expectedDate, req.focusHint, undefined, req.detectedCitation !== undefined);

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
        ...(structuredOutputEnabled()
          ? { text: { format: openAIJsonSchemaFormat(wireSchema('openai')) } }
          : {}),
      },
    }));
  }

  let synthBatchId = freshBatch.synthesis_batch_id;
  if (synthBatchId) {
    console.log(`  Resuming synthesis batch from state: ${synthBatchId}`);
  } else {
    if (synthesisLines.length === 0) {
      freshBatch.status = 'ended';
      mergeBatch(freshBatch);
      return;
    }
    const synthInputFileId = await client.uploadJsonl(synthesisLines.join('\n'));
    const synthBatch = await client.createBatch(synthInputFileId);
    synthBatchId = synthBatch.id;
    // Persist the id (and lane results) before polling: a crash mid-poll
    // must resume this batch, not resubmit and pay for it again.
    freshBatch.synthesis_batch_id = synthBatchId;
    mergeBatch(freshBatch);
    console.log(`  Submitted OpenAI synthesis batch: ${synthBatchId} (${synthesisLines.length} request(s), model: ${synthesisModel})`);
  }

  await pollUntilEnded('synthesis', POLL_SYNTH_INITIAL_WAIT_MS, () => client.retrieveBatch(synthBatchId));

  for await (const entry of client.iterateBatchResults(synthBatchId)) {
    const req = freshBatch.requests[entry.customId];
    if (!req || req.type !== 'explainer') continue;

    if (entry.type === 'errored') {
      req.result = 'errored';
      req.error = entry.error ?? 'Unknown synthesis error';
      console.error(`  ✗ ${entry.customId} — ${req.error}`);
      continue;
    }

    try {
      const saved = await saveThroughSeam(
        buildResultReceipt('openai', 'batch-api', synthBatchId, entry.customId, synthesisModel,
          { text: entry.text ?? '', inputTokens: entry.inputTokens ?? 0, outputTokens: entry.outputTokens ?? 0 }),
        req, expectedDate, modelConfig.repairModel,
        createRepairAdapter(client, 'api_key', modelConfig.repairModel, modelConfig.repairMaxTokens),
      );
      if (saved) savedResults.push(saved);
    } catch (error) {
      req.result = 'errored';
      req.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${entry.customId} — ${req.error}`);
    }
  }

  freshBatch.status = 'ended';
  mergeBatch(freshBatch);
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
  const savedResults: string[] = [];

  const systemPrompt = buildSystemPrompt();
  const expectedDate = dateFromIso(freshBatch.submitted_at);
  for (const [customId, req] of Object.entries(freshBatch.requests)) {
    if (req.type !== 'explainer') continue;
    const item = requestToInputItem(customId, req);
    const userInstruction = buildUserInstruction(expectedDate, item.focusHint, undefined, item.detectedCitation !== undefined);

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

        const missing = missingLanes(laneMap);
        if (missing.length > 0) {
          req.result = 'errored';
          req.error = `Lane(s) failed: ${missing.join(', ')}`;
          console.error(`  ✗ ${customId} — ${req.error}`);
          continue;
        }

        const laneBody = OPENAI_LANES
          .map(lane => `## ${lane}\n${laneMap[lane]}`)
          .join('\n\n');

        synthesis = await client.createMessage(
          freshBatch.synthesis_model ?? modelConfig.synthesisModel,
          modelConfig.synthesisMaxTokens,
          systemPrompt,
          [{
            role: 'user',
            content: [{ type: 'input_text', text: `${userInstruction}\n\nUse these extracted lane notes as your factual substrate:\n\n${laneBody}` }],
          }],
          false,
          wireSchema('openai')
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
          item.isUrl,
          wireSchema('openai')
        );
      }

      const saved = await saveThroughSeam(
        buildResultReceipt('openai', 'codex_cli', batchState.id, customId, freshBatch.synthesis_model ?? modelConfig.synthesisModel,
          synthesis),
        req, expectedDate, modelConfig.repairModel,
        createRepairAdapter(client, 'codex_cli', modelConfig.repairModel, modelConfig.repairMaxTokens),
      );
      if (saved) savedResults.push(saved);
    } catch (error) {
      req.result = 'errored';
      req.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${customId} — ${req.error}`);
    }
  }

  mergeBatch(freshBatch);
  await exportSavedHtml(savedResults);
}


async function runClaudeSync(batchId: string, items: InputItem[]): Promise<void> {
  const modelConfig = getModelConfig('claude');
  const authMode = detectClaudeAuthMode(true);
  if (authMode !== 'claude_cli') {
    throw new Error(
      'Sync mode runs only on the Claude max-plan OAuth route (CLAUDE_CODE_OAUTH_TOKEN). ' +
      'Use batch mode (drop --sync) for ANTHROPIC_API_KEY.'
    );
  }
  const client = getClaudeClient();
  const freshState = readState();
  const freshBatch = getBatchById(freshState, batchId);
  if (!freshBatch) return;
  const savedResults: string[] = [];
  const expectedDate = dateFromIso(freshBatch.submitted_at);

  console.log(`  Using Claude max-plan route (CLAUDE_CODE_OAUTH_TOKEN) — no API credits consumed`);

  for (const item of items) {
    const req = freshBatch.requests[item.customId];
    if (!req) continue;
    const userInstruction = buildUserInstruction(expectedDate, item.focusHint, undefined, item.detectedCitation !== undefined);
    try {
      const response = await client.createMessageViaCli(
        modelConfig.synthesisModel,
        buildSystemPrompt(),
        buildClaudeRequestContent(item, userInstruction)
      );
      const saved = await saveThroughSeam(
        buildResultReceipt('claude', authMode, batchId, item.customId, modelConfig.synthesisModel,
          response),
        req, expectedDate, modelConfig.repairModel,
        createRepairAdapter(client, authMode, modelConfig.repairModel, modelConfig.repairMaxTokens),
      );
      if (saved) savedResults.push(saved);
    } catch (error) {
      req.result = 'errored';
      req.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${item.customId} — ${req.error}`);
    }
  }

  freshBatch.status = 'ended';
  mergeBatch(freshBatch);
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
      mergeOpenAIFileCache(fileCache);
    }
  } else {
    for (const item of items) uploadedFileIds.set(item.customId, null);
  }

  const freshState = readState();
  const freshBatch = getBatchById(freshState, batchId);
  if (!freshBatch) return;
  const systemPrompt = buildSystemPrompt();
  const expectedDate = dateFromIso(freshBatch.submitted_at);
  const savedResults: string[] = [];

  for (const item of items) {
    const req = freshBatch.requests[item.customId];
    if (!req) continue;
    const userInstruction = buildUserInstruction(expectedDate, item.focusHint, undefined, item.detectedCitation !== undefined);

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

        const missing = missingLanes(laneMap);
        if (missing.length > 0) {
          req.result = 'errored';
          req.error = `Lane(s) failed: ${missing.join(', ')}`;
          console.error(`  ✗ ${item.customId} — ${req.error}`);
          continue;
        }

        const laneBody = OPENAI_LANES
          .map(lane => `## ${lane}\n${laneMap[lane]}`)
          .join('\n\n');

        synthesis = await client.createMessage(
          freshBatch.synthesis_model ?? modelConfig.synthesisModel,
          modelConfig.synthesisMaxTokens,
          systemPrompt,
          [{
            role: 'user',
            content: [{ type: 'input_text', text: `${userInstruction}\n\nUse these extracted lane notes as your factual substrate:\n\n${laneBody}` }],
          }],
          false,
          wireSchema('openai')
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
          mode === 'codex_cli' && item.isUrl,
          wireSchema('openai')
        );
      }

      const saved = await saveThroughSeam(
        buildResultReceipt('openai', mode, batchId, item.customId, freshBatch.synthesis_model ?? modelConfig.synthesisModel,
          synthesis),
        req, expectedDate, modelConfig.repairModel,
        createRepairAdapter(client, mode, modelConfig.repairModel, modelConfig.repairMaxTokens),
      );
      if (saved) savedResults.push(saved);
    } catch (error) {
      req.result = 'errored';
      req.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${item.customId} — ${req.error}`);
    }
  }

  freshBatch.status = 'ended';
  mergeBatch(freshBatch);
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
      // Persisted like the batch path: figure extraction reads these back
      // from state by customId, so dropping them silently ignores .focus.md
      // figure pins and DOM figure candidates on sync runs.
      focusHint: item.focusHint,
      imageOverride: item.imageOverride,
      figureCandidates: item.figureCandidates,
      recreate: item.recreate,
      ...provenanceFields(item, dateFromIso(batchState.submitted_at)),
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
          focusHint: item.focusHint,
          imageOverride: item.imageOverride,
        };
      }
    }
  }

  mergeBatch(batchState);

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

  await pollUntilEnded('batch', POLL_INITIAL_WAIT_MS, () => pollBatchStatus(batchProvider, batchState.id));

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
