import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertProviderCapabilities, checkResult, LlmContractError } from '../llm-contract';
import type {
  CallContext, ErrorCode, LlmProvider, NormalizedResult, ProviderRequest, SchemaRef, Stage, TokenUsage,
} from '../llm-contract';
import { childEnvironment } from '../routes';
import type { CredentialBinding } from '../routes';

export interface CodexSubscriptionOptions {
  binding: CredentialBinding;
  schemaFor(ref: SchemaRef): unknown;
  systemPrompt(stage: Stage): string;
  sourceRoot: string;
  parentEnv: Readonly<Record<string, string | undefined>>;
  authFile: string;
  codexBin?: string;
  tmpRoot?: string;
  killGraceMs?: number;
}

interface Payload {
  prompt: string;
  schema: unknown;
  images: Array<{ path: string; label: string }>;
  sourceDelivery: 'extracted-text';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function subscriptionLogin(file: string): Promise<Record<string, unknown>> {
  const invalid = () => new LlmContractError('CODEX_AUTH_NOT_SUBSCRIPTION', 'A valid Codex ChatGPT login without an API key is required.');
  let auth: unknown;
  try { auth = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { throw invalid(); }
  if (!isRecord(auth) || auth.auth_mode !== 'chatgpt' || !isRecord(auth.tokens)
    || typeof auth.tokens.access_token !== 'string' || !auth.tokens.access_token.trim()
    || ![undefined, null, ''].includes(auth.OPENAI_API_KEY as undefined | null | string)) {
    throw invalid();
  }
  return {
    OPENAI_API_KEY: null, auth_mode: auth.auth_mode, tokens: auth.tokens,
    ...(Object.hasOwn(auth, 'last_refresh') ? { last_refresh: auth.last_refresh } : {}),
  };
}

async function invoke(
  opts: CodexSubscriptionOptions, req: ProviderRequest, ctx: CallContext,
): Promise<NormalizedResult> {
  const login = await subscriptionLogin(opts.authFile);
  const root = await fs.mkdtemp(path.join(opts.tmpRoot ?? os.tmpdir(), 'codex-subscription-'));
  try {
    await fs.chmod(root, 0o700);
    const work = path.join(root, 'work');
    const auth = path.join(root, 'auth');
    const artifacts = path.join(root, 'artifacts');
    for (const dir of [work, auth, artifacts]) await fs.mkdir(dir, { mode: 0o700 });
    const payload = req.payload as Payload;
    const schemaFile = path.join(artifacts, 'schema.json');
    const outputFile = path.join(artifacts, 'last-message.txt');
    await fs.writeFile(path.join(auth, 'auth.json'), JSON.stringify(login), { mode: 0o600 });
    await fs.writeFile(schemaFile, JSON.stringify(payload.schema), { mode: 0o600 });
    const args = [
      'exec', '--model', req.model, '--json', '--sandbox', 'read-only', '--skip-git-repo-check',
      '--ephemeral', '--ignore-user-config', '--ignore-rules', '-C', work,
      '--output-schema', schemaFile, '--output-last-message', outputFile,
      ...payload.images.flatMap(image => ['--image', image.path]), '-',
    ];
    const usage: TokenUsage = {
      in: null, out: null, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null, source: 'unavailable',
    };
    let providerRequestId: string | undefined;
    let completed = false;
    let failure = false;
    let timedOut = false;
    let cancelled = false;
    let spawnError = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    const parseLine = (line: string) => {
      let event: unknown;
      try { event = JSON.parse(line); } catch { return; }
      if (!isRecord(event)) return;
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') providerRequestId = event.thread_id;
      if (event.type === 'error' || (typeof event.type === 'string' && event.type.startsWith('turn.')
        && event.type !== 'turn.started' && event.type !== 'turn.completed')) failure = true;
      if (event.type !== 'turn.completed') return;
      completed = true;
      if (!isRecord(event.usage)) return;
      usage.source = 'reported';
      for (const [key, vendorKey] of [['in', 'input_tokens'], ['out', 'output_tokens'], ['cacheRead', 'cached_input_tokens']] as const) {
        const count = event.usage[vendorKey];
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
          usage[key] = (usage[key] ?? 0) + count;
        }
      }
    };

    await new Promise<void>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(opts.codexBin ?? 'codex', args, {
          cwd: work, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...childEnvironment(opts.binding, opts.parentEnv), CODEX_HOME: auth },
        });
      } catch {
        spawnError = true;
        resolve();
        return;
      }
      let escalation: Promise<void> | undefined;
      const killGroup = (signal: NodeJS.Signals) => {
        if (child.pid !== undefined) {
          try { process.kill(-child.pid, signal); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') spawnError = true; }
        }
      };
      const terminate = () => {
        if (escalation) return;
        killGroup('SIGTERM');
        // The parent can exit before a descendant that ignores the first signal.
        escalation = new Promise<void>(done => setTimeout(() => {
          killGroup('SIGKILL');
          done();
        }, opts.killGraceMs ?? 5000));
      };
      const onAbort = () => { cancelled = true; terminate(); };
      const remaining = Date.parse(ctx.deadline) - Date.now();
      const timer = setTimeout(() => { timedOut = true; terminate(); }, Math.max(0, remaining));
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      if (ctx.signal.aborted) onAbort();

      const maxLineBytes = 8 * 1024 * 1024;
      let pending: Buffer[] = [];
      let pendingBytes = 0;
      let droppingLine = false;
      child.stdout.on('data', (chunk: Buffer) => {
        let start = 0;
        while (start < chunk.length) {
          const newline = chunk.indexOf(10, start);
          const end = newline < 0 ? chunk.length : newline;
          const part = chunk.subarray(start, end);
          if (!droppingLine && pendingBytes + part.length <= maxLineBytes) {
            pending.push(part);
            pendingBytes += part.length;
          } else {
            failure = true;
            droppingLine = true;
            pending = [];
            pendingBytes = 0;
          }
          if (newline < 0) break;
          if (!droppingLine) parseLine(Buffer.concat(pending, pendingBytes).toString('utf8'));
          pending = [];
          pendingBytes = 0;
          droppingLine = false;
          start = newline + 1;
        }
      });
      child.stderr.resume();
      child.stdin.on('error', () => { spawnError = true; });
      child.once('error', () => { spawnError = true; });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);
        exitCode = code;
        exitSignal = signal;
        if (!droppingLine && pendingBytes) parseLine(Buffer.concat(pending, pendingBytes).toString('utf8'));
        if (escalation) void escalation.then(resolve);
        else resolve();
      });
      child.stdin.end(payload.prompt);
    });

    const common = {
      provider: req.provider, route: req.route, stage: req.stage, model: req.model,
      customId: req.customId, attemptId: req.attemptId, providerRequestId, usage,
    };
    let code: ErrorCode | undefined = timedOut ? 'TIMEOUT' : cancelled ? 'CANCELLED'
      : failure ? 'CLI_FAILURE' : spawnError || exitCode !== 0 || exitSignal ? 'CLI_EXIT'
        : !completed ? 'MISSING_OUTPUT' : undefined;
    let text: string | undefined;
    if (!code) {
      try { text = await fs.readFile(outputFile, 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        code = 'MISSING_OUTPUT';
      }
      if (!text?.trim()) code = 'MISSING_OUTPUT';
    }
    return checkResult(code
      ? { ...common, finishReason: 'error', error: { code, message: `Codex subscription call failed: ${code}.`, retryable: false } }
      : { ...common, finishReason: 'stop', text });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

export function createCodexSubscriptionProvider(opts: CodexSubscriptionOptions): LlmProvider {
  if (opts.binding.provider !== 'openai' || opts.binding.surface !== 'codex-cli'
    || opts.binding.credentialKind !== 'codex-chatgpt-login' || opts.binding.route !== 'subscription-cli') {
    throw new LlmContractError('CODEX_AUTH_NOT_SUBSCRIPTION', 'The Codex subscription route requires a ChatGPT login binding.');
  }
  const unsupported = () => new LlmContractError('ROUTE_UNSUPPORTED', 'Only OpenAI subscription completions are supported.');
  const provider: LlmProvider = {
    id: 'openai', routes: ['subscription-cli'],
    capabilities: { byRoute: { 'subscription-cli': {
      structured: 'strict', schemaEvidence: 'unverified', vision: true, pdfNative: false,
      batch: false, subscription: true, outputTokenLimit: 'advisory',
    } } },
    async buildRequest(stage, item, plan) {
      const tier = plan.tiers[stage];
      if (!tier || tier.provider !== 'openai' || tier.route !== 'subscription-cli') throw unsupported();
      if (typeof item.source.text !== 'string' || !item.source.text.trim()) {
        throw new LlmContractError('SOURCE_TEXT_UNAVAILABLE', 'Extracted source text is required.');
      }
      const images = item.source.images.map(image => ({
        path: path.resolve(opts.sourceRoot, image.relativePath), label: image.label,
      }));
      const manifest = images.length
        ? `Attached images, in order:\n${images.map((image, i) => `Image ${i + 1}: ${image.label}`).join('\n')}\n\n` : '';
      const prompt = `${opts.systemPrompt(stage)}\n\n${item.instruction}\n\n${manifest}Source text:\n${item.source.text}`;
      const payload: Payload = { prompt, schema: opts.schemaFor(item.schema), images, sourceDelivery: 'extracted-text' };
      return {
        provider: 'openai', route: 'subscription-cli', stage, model: tier.model,
        customId: item.customId, attemptId: item.attemptId, schema: item.schema,
        payload, wireBytes: Buffer.byteLength(prompt),
      };
    },
    async complete(req, ctx) {
      if (req.provider !== 'openai' || req.route !== 'subscription-cli') throw unsupported();
      return invoke(opts, req, ctx);
    },
    async submitBatch() { throw unsupported(); },
    async getBatch() { throw unsupported(); },
    results() { throw unsupported(); },
  };
  assertProviderCapabilities(provider);
  return provider;
}
