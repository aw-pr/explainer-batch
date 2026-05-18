import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type ProviderName = 'claude' | 'openai';
export type ClaudeAuthMode = 'api_key' | 'claude_cli';

function hasClaudeCliSession(): boolean {
  return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
}

export function detectClaudeAuthMode(preferCli = false): ClaudeAuthMode {
  if (preferCli && hasClaudeCliSession()) {
    if (process.env.ANTHROPIC_API_KEY) {
      throw new Error('Claude sync mode received both CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY. Refusing to choose between OAuth and API-key billing.');
    }
    return 'claude_cli';
  }
  if (process.env.ANTHROPIC_API_KEY) return 'api_key';
  if (hasClaudeCliSession()) return 'claude_cli';
  throw new Error(
    'Claude auth not configured. Set ANTHROPIC_API_KEY in .env.local, ' +
    'or run `claude setup-token` and export CLAUDE_CODE_OAUTH_TOKEN for max-plan mode.'
  );
}

export interface ProviderBatchStatus {
  status: string;
  counts: {
    processing: number;
    succeeded: number;
    errored: number;
  };
}

export interface ProviderMessageResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ClaudeBatchResultItem {
  customId: string;
  type: 'succeeded' | 'errored';
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface OpenAIBatchResultItem {
  customId: string;
  type: 'succeeded' | 'errored';
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

const CODEX_AUTH_FILE = path.join(os.homedir(), '.codex', 'auth.json');

function readCodexAuth(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(CODEX_AUTH_FILE)) return null;
    return JSON.parse(fs.readFileSync(CODEX_AUTH_FILE, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseOpenAIApiKey(): string | null {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) return process.env.OPENAI_API_KEY;
  const auth = readCodexAuth();
  const maybe = auth?.OPENAI_API_KEY;
  return typeof maybe === 'string' && maybe.trim() ? maybe : null;
}

function hasCodexChatGPTAuth(): boolean {
  const auth = readCodexAuth();
  if (!auth) return false;
  const mode = auth.auth_mode;
  const tokens = auth.tokens as { access_token?: unknown } | undefined;
  return mode === 'chatgpt' && typeof tokens?.access_token === 'string' && tokens.access_token.length > 0;
}

// ESM-only package in a CommonJS repo — opaque import keeps TS emitter from rewriting it
const agentSdkImport = new Function('m', 'return import(m)') as (m: string) => Promise<{ query: ClaudeAgentQuery }>;

type ClaudeAgentQuery = (args: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<ClaudeSdkMessage>;
type ClaudeSdkMessage =
  | { type: 'assistant'; message: { content: Array<{ type: string; text?: string }> } }
  | { type: 'result'; subtype: string; usage?: { input_tokens?: number; output_tokens?: number }; is_error?: boolean; message?: string }
  | { type: string };

const CLI_DISALLOWED_TOOLS = [
  'Write', 'Edit', 'MultiEdit', 'Bash', 'BashOutput', 'KillShell',
  'Glob', 'Grep', 'NotebookEdit', 'TodoWrite', 'Task', 'SlashCommand',
  'ListMcpResources',
];

export class ClaudeProvider {
  readonly name: ProviderName = 'claude';
  private readonly client: Anthropic | null;

  constructor(apiKey?: string) {
    this.client = apiKey ? new Anthropic({
      apiKey,
      defaultHeaders: {
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
    }) : null;
  }

  private getClient(): Anthropic {
    if (!this.client) throw new Error('ANTHROPIC_API_KEY required for batch/API operations');
    return this.client;
  }

  async createBatch(requests: Array<{ customId: string; model: string; maxTokens: number; system: string; content: Anthropic.MessageParam['content'] }>): Promise<{ id: string; status: string }> {
    const payload = requests.map(req => ({
      custom_id: req.customId,
      params: {
        model: req.model,
        max_tokens: req.maxTokens,
        system: [{ type: 'text' as const, text: req.system, cache_control: { type: 'ephemeral' } }] as never,
        messages: [{ role: 'user' as const, content: req.content }],
      },
    }));

    const batch = await this.getClient().messages.batches.create({ requests: payload } as never);
    return { id: batch.id, status: batch.processing_status };
  }

  async retrieveBatch(batchId: string): Promise<ProviderBatchStatus> {
    const batch = await this.getClient().messages.batches.retrieve(batchId);
    return {
      status: batch.processing_status,
      counts: {
        processing: batch.request_counts.processing,
        succeeded: batch.request_counts.succeeded,
        errored: batch.request_counts.errored,
      },
    };
  }

  async *iterateBatchResults(batchId: string): AsyncIterable<ClaudeBatchResultItem> {
    for await (const item of await this.getClient().messages.batches.results(batchId)) {
      if (item.result.type !== 'succeeded') {
        const errorText = item.result.type === 'errored' ? JSON.stringify(item.result.error) : item.result.type;
        yield { customId: item.custom_id, type: 'errored', error: errorText };
        continue;
      }

      const message = item.result.message;
      const textBlock = message.content.find(c => c.type === 'text');
      const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
      yield {
        customId: item.custom_id,
        type: 'succeeded',
        text,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
    }
  }

  async createMessage(
    model: string,
    maxTokens: number,
    system: string,
    content: string,
    _useSearch = false
  ): Promise<ProviderMessageResponse> {
    return this.createMessageWithContent(model, maxTokens, system, content);
  }

  async createMessageWithContent(
    model: string,
    maxTokens: number,
    system: string,
    content: Anthropic.MessageParam['content']
  ): Promise<ProviderMessageResponse> {
    // Use streaming to avoid the SDK's 10-minute timeout cap on long generations.
    const stream = this.getClient().messages.stream({
      model,
      max_tokens: maxTokens,
      system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' } }] as never,
      messages: [{ role: 'user', content }],
    });
    const resp = await stream.finalMessage();

    const text = resp.content
      .filter(block => block.type === 'text')
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('\n');

    return {
      text,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
    };
  }

  async createMessageViaCli(model: string, system: string, prompt: string): Promise<ProviderMessageResponse> {
    const maxTurns = Number.parseInt(process.env.CLAUDE_AGENT_MAX_TURNS ?? '3', 10);
    const mod = await agentSdkImport('@anthropic-ai/claude-agent-sdk');
    const iter = mod.query({
      prompt,
      options: {
        model,
        systemPrompt: system,
        allowedTools: ['Read', 'WebFetch'],
        disallowedTools: CLI_DISALLOWED_TOOLS,
        permissionMode: 'bypassPermissions',
        maxTurns: Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 3,
        settingSources: [],
      },
    });

    let rawText = '';
    let tokensIn = 0;
    let tokensOut = 0;

    for await (const msg of iter) {
      if (msg.type === 'assistant') {
        const content = (msg as { message?: { content?: Array<{ type: string; text?: string }> } }).message?.content ?? [];
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            rawText += (rawText ? '\n' : '') + block.text;
          }
        }
      } else if (msg.type === 'result') {
        const r = msg as { usage?: { input_tokens?: number; output_tokens?: number }; is_error?: boolean; subtype?: string; message?: string };
        tokensIn = r.usage?.input_tokens ?? tokensIn;
        tokensOut = r.usage?.output_tokens ?? tokensOut;
        if (r.is_error || (r.subtype && r.subtype !== 'success')) {
          throw new Error(`Agent SDK: ${r.subtype ?? 'error'}${r.message ? ': ' + r.message : ''}`);
        }
      }
    }

    return { text: rawText, inputTokens: tokensIn, outputTokens: tokensOut };
  }
}

export type OpenAIAuthMode = 'api_key' | 'codex_cli' | 'none';

interface ResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface ResponsesOutputItem {
  content?: Array<{ text?: string }>;
}

interface ResponsesBody {
  output_text?: string;
  output?: ResponsesOutputItem[];
  usage?: ResponseUsage;
}

export class OpenAIProvider {
  readonly name: ProviderName = 'openai';
  private readonly baseUrl: string;
  private readonly apiKey: string | null;

  constructor(baseUrl = 'https://api.openai.com/v1') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = parseOpenAIApiKey();
  }

  authMode(): OpenAIAuthMode {
    if (this.apiKey) return 'api_key';
    if (hasCodexChatGPTAuth()) return 'codex_cli';
    return 'none';
  }

  requireBatchAuth(): void {
    if (this.authMode() !== 'api_key') {
      throw new Error('OpenAI batch mode requires API-backed auth (OPENAI_API_KEY or ~/.codex/auth.json OPENAI_API_KEY). Codex chatgpt auth supports sync-only calls.');
    }
  }

  private authHeader(): Record<string, string> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not available for API request');
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async requestJson(method: string, endpoint: string, body?: unknown, isMultipart = false): Promise<unknown> {
    const headers: Record<string, string> = this.authHeader();
    if (!isMultipart) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : (isMultipart ? body as FormData : JSON.stringify(body)),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI ${method} ${endpoint} failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
    }

    return response.json();
  }

  private async requestText(method: string, endpoint: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: this.authHeader(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI ${method} ${endpoint} failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
    }

    return response.text();
  }

  async uploadFile(buffer: Buffer, filename: string, purpose: 'batch' | 'user_data'): Promise<string> {
    this.requireBatchAuth();
    const form = new FormData();
    form.append('purpose', purpose);
    form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
    const file = await this.requestJson('POST', '/files', form, true) as { id: string };
    return file.id;
  }

  async fileExists(fileId: string): Promise<boolean> {
    this.requireBatchAuth();
    try {
      await this.requestJson('GET', `/files/${fileId}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('404')) return false;
      throw error;
    }
  }

  async uploadJsonl(lines: string): Promise<string> {
    this.requireBatchAuth();
    const form = new FormData();
    form.append('purpose', 'batch');
    form.append('file', new Blob([`${lines}\n`], { type: 'application/jsonl' }), 'batch-input.jsonl');
    const file = await this.requestJson('POST', '/files', form, true) as { id: string };
    return file.id;
  }

  async createBatch(inputFileId: string): Promise<{ id: string; status: string }> {
    this.requireBatchAuth();
    const batch = await this.requestJson('POST', '/batches', {
      input_file_id: inputFileId,
      endpoint: '/v1/responses',
      completion_window: '24h',
    }) as { id: string; status?: string };

    return { id: batch.id, status: batch.status ?? 'submitted' };
  }

  async retrieveBatch(batchId: string): Promise<ProviderBatchStatus & { outputFileId?: string; errorFileId?: string }> {
    this.requireBatchAuth();
    const batch = await this.requestJson('GET', `/batches/${batchId}`) as {
      status?: string;
      output_file_id?: string;
      error_file_id?: string;
      request_counts?: { total?: number; completed?: number; failed?: number };
    };

    const total = Number(batch.request_counts?.total ?? 0);
    const succeeded = Number(batch.request_counts?.completed ?? 0);
    const errored = Number(batch.request_counts?.failed ?? 0);

    const endedStates = new Set(['completed', 'failed', 'cancelled', 'expired']);
    return {
      status: endedStates.has(batch.status ?? '') ? 'ended' : (batch.status ?? 'processing'),
      counts: {
        processing: Math.max(total - succeeded - errored, 0),
        succeeded,
        errored,
      },
      outputFileId: batch.output_file_id,
      errorFileId: batch.error_file_id,
    };
  }

  async *iterateBatchResults(batchId: string): AsyncIterable<OpenAIBatchResultItem> {
    const batch = await this.retrieveBatch(batchId);

    if (batch.outputFileId) {
      const content = await this.requestText('GET', `/files/${batch.outputFileId}/content`);
      for (const line of content.split('\n').map(s => s.trim()).filter(Boolean)) {
        const row = JSON.parse(line) as { custom_id?: string; response?: { body?: ResponsesBody }; error?: { message?: string } };
        if (!row.custom_id) continue;
        if (row.error) {
          yield { customId: row.custom_id, type: 'errored', error: row.error.message ?? 'Unknown OpenAI batch error' };
          continue;
        }

        const body = row.response?.body;
        if (!body) {
          yield { customId: row.custom_id, type: 'errored', error: 'Missing response body' };
          continue;
        }

        const text = extractOutputText(body);
        yield {
          customId: row.custom_id,
          type: 'succeeded',
          text,
          inputTokens: Number(body.usage?.input_tokens ?? 0),
          outputTokens: Number(body.usage?.output_tokens ?? 0),
        };
      }
    }

    if (batch.errorFileId) {
      const content = await this.requestText('GET', `/files/${batch.errorFileId}/content`);
      for (const line of content.split('\n').map(s => s.trim()).filter(Boolean)) {
        const row = JSON.parse(line) as { custom_id?: string; error?: { message?: string } };
        if (!row.custom_id) continue;
        yield { customId: row.custom_id, type: 'errored', error: row.error?.message ?? 'Request failed' };
      }
    }
  }

  async createMessage(
    model: string,
    maxOutputTokens: number,
    instructions: string,
    input: Array<{ role: 'user'; content: Array<Record<string, unknown>> }>,
    useSearch = false
  ): Promise<ProviderMessageResponse> {
    if (this.authMode() === 'api_key') {
      const body = await this.requestJson('POST', '/responses', {
        model,
        max_output_tokens: maxOutputTokens,
        instructions,
        input,
      }) as ResponsesBody;

      return {
        text: extractOutputText(body),
        inputTokens: Number(body.usage?.input_tokens ?? 0),
        outputTokens: Number(body.usage?.output_tokens ?? 0),
      };
    }

    if (this.authMode() !== 'codex_cli') {
      throw new Error('OpenAI auth not configured. Configure OPENAI_API_KEY or login with codex chatgpt auth.');
    }

    const prompt = `${instructions}\n\n${flattenInputForCodex(input)}`;
    const result = await runViaCodexCli(model, prompt, useSearch);
    return result;
  }
}

function extractOutputText(body: ResponsesBody): string {
  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text;
  const chunks: string[] = [];
  for (const out of body.output ?? []) {
    for (const c of out.content ?? []) {
      if (typeof c.text === 'string') chunks.push(c.text);
    }
  }
  return chunks.join('\n').trim();
}

function flattenInputForCodex(input: Array<{ role: 'user'; content: Array<Record<string, unknown>> }>): string {
  const parts: string[] = [];
  for (const msg of input) {
    for (const content of msg.content) {
      const text = content.text;
      if (typeof text === 'string') parts.push(text);
      const fileData = content.file_data;
      if (typeof fileData === 'string') parts.push(`Attached file (base64 PDF omitted in codex-cli mode): ${fileData.slice(0, 120)}...`);
      const fileId = content.file_id;
      if (typeof fileId === 'string') parts.push(`Attached file ID: ${fileId}`);
    }
  }
  return parts.join('\n\n');
}

async function runViaCodexCli(model: string, prompt: string, useSearch: boolean): Promise<ProviderMessageResponse> {
  const outputPath = path.join(os.tmpdir(), `explainer-codex-${Date.now()}.txt`);
  const args = [
    ...(useSearch ? ['--search'] : []),
    'exec',
    '--json',
    '--model',
    model,
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--output-last-message',
    outputPath,
    prompt,
  ];

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      reject(new Error(`codex exec failed (${code}): ${stderr || 'no stderr'}`));
    });
  });

  const text = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf-8') : '';
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  let inputTokens = 0;
  let outputTokens = 0;
  const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
  for (const line of stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as { type?: string; usage?: { input_tokens?: number; output_tokens?: number } };
      if (event.type === 'turn.completed') {
        inputTokens += Number(event.usage?.input_tokens ?? 0);
        outputTokens += Number(event.usage?.output_tokens ?? 0);
      }
    } catch {
      // ignore non-json lines
    }
  }

  return { text, inputTokens, outputTokens };
}

export function getProviderFromArgs(args: string[]): ProviderName {
  const idx = args.findIndex(arg => arg === '--provider');
  const fromArg = idx >= 0 ? args[idx + 1] : undefined;
  const fromEnv = process.env.PROVIDER;
  const raw = (fromArg ?? fromEnv ?? 'claude').toLowerCase();
  return raw === 'openai' ? 'openai' : 'claude';
}

export function parseOpenAIAuthMode(): OpenAIAuthMode {
  if (parseOpenAIApiKey()) return 'api_key';
  if (hasCodexChatGPTAuth()) return 'codex_cli';
  return 'none';
}
