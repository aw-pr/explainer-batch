import fs from 'fs';
import path from 'path';
import type { ProviderName } from './providers';

const STATE_FILE = path.join(__dirname, '..', 'state.json');

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
  };
}

export interface BatchState {
  id: string;
  provider?: ProviderName;
  model: string;
  lane_model?: string;
  synthesis_model?: string;
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
  } catch {
    return empty();
  }
}

export function writeState(state: State): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function addBatch(state: State, batch: BatchState): void {
  state.batches.push(batch);
}

export function getLatestPendingBatch(state: State): BatchState | undefined {
  return [...state.batches]
    .reverse()
    .find(b => b.status === 'processing');
}

export function getLatestPendingBatchByProvider(state: State, provider: ProviderName): BatchState | undefined {
  return [...state.batches]
    .reverse()
    .find(b => b.status === 'processing' && (b.provider ?? 'claude') === provider);
}

export function getBatchById(state: State, id: string): BatchState | undefined {
  return state.batches.find(b => b.id === id);
}
