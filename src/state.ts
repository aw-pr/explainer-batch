import fs from 'fs';
import path from 'path';
import type { ProviderName } from './providers';

// Overridable so parallel runs can each use an isolated state file (avoids the
// read-modify-write race on a single shared state.json). Defaults to the repo root.
const STATE_FILE = process.env.EXPLAINER_STATE_FILE
  ? path.resolve(process.env.EXPLAINER_STATE_FILE)
  : path.join(__dirname, '..', 'state.json');

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  standard_cost_usd: number;
  batch_cost_usd: number;
  saving_usd: number;
}

export interface RequestState {
  type: 'explainer' | 'lane';
  lane?: string;
  input: string; // PDF filename (relative to input/) or URL
  source?: {
    kind: 'url' | 'local_pdf';
    url?: string;
    filename?: string;
    filePath?: string;
  };
  output: string | null;
  result: 'pending' | 'succeeded' | 'errored';
  error: string | null;
  usage?: TokenUsage;
  focusHint?: string;
  imageOverride?: {
    source_figure: string;
    caption?: string;
    alt_text?: string;
    pageHint?: number;
  };
}

export interface BatchState {
  id: string;
  provider?: ProviderName;
  model: string;
  lane_model?: string;
  synthesis_model?: string;
  /** Second-stage OpenAI batch id, persisted at creation so a crash during
   *  the synthesis poll can resume instead of resubmitting (and repaying). */
  synthesis_batch_id?: string;
  submitted_at: string;
  status: 'processing' | 'ended';
  requests: Record<string, RequestState>;
}

export interface State {
  batches: BatchState[];
  openai_file_cache?: Record<string, {
    file_id: string;
    sha256: string;
    size_bytes: number;
    updated_at: string;
  }>;
}

function empty(): State {
  return { batches: [], openai_file_cache: {} };
}

export function readState(): State {
  if (!fs.existsSync(STATE_FILE)) return empty();
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State;
  } catch (error) {
    // Never silently discard a state file that fails to parse: it holds batch
    // ids and Files API ids that cannot be recovered any other way.
    const backupFile = `${STATE_FILE}.corrupt-${Date.now()}`;
    fs.copyFileSync(STATE_FILE, backupFile);
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `\n  ✗ state: FAILED to parse ${path.basename(STATE_FILE)}: ${message}\n` +
      `  ✗ state: corrupt file preserved at ${backupFile}\n` +
      `  ✗ state: continuing with EMPTY state; restore the backup to recover batch ids\n`
    );
    return empty();
  }
}

export function writeState(state: State): void {
  // Write-then-rename so a crash mid-write can never leave a truncated
  // state.json (the rename is atomic on the same filesystem).
  const tmpFile = `${STATE_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpFile, STATE_FILE);
}

// Collectors hold a batch in memory across long awaits (repairs, synthesis).
// Writing back their whole stale State snapshot would clobber anything other
// runs persisted meanwhile, so merge just this batch into a fresh read.
export function mergeBatch(batch: BatchState): void {
  const state = readState();
  const index = state.batches.findIndex(b => b.id === batch.id);
  if (index >= 0) {
    state.batches[index] = batch;
  } else {
    state.batches.push(batch);
  }
  writeState(state);
}

// Same stale-snapshot concern as mergeBatch: file uploads happen between the
// cache read and the write, so merge keys into a fresh read (ours win).
export function mergeOpenAIFileCache(cache: NonNullable<State['openai_file_cache']>): void {
  const state = readState();
  state.openai_file_cache = { ...(state.openai_file_cache ?? {}), ...cache };
  writeState(state);
}

export function getLatestPendingBatchByProvider(state: State, provider: ProviderName): BatchState | undefined {
  return [...state.batches]
    .reverse()
    .find(b => b.status === 'processing' && (b.provider ?? 'claude') === provider);
}

export function getBatchById(state: State, id: string): BatchState | undefined {
  return state.batches.find(b => b.id === id);
}
