import fs from 'fs';
import path from 'path';
import type { ProviderName } from './providers';

export const OPENAI_LANES = ['methods', 'results', 'limitations', 'implications'] as const;
export type OpenAILane = typeof OPENAI_LANES[number];

export interface ModelConfig {
  provider: ProviderName;
  batchModel: string;
  laneModel: string;
  synthesisModel: string;
  repairModel: string;
  visionModel: string;
  maxTokens: number;
  laneMaxTokens: number;
  synthesisMaxTokens: number;
  repairMaxTokens: number;
}

interface PartialModelConfig {
  batchModel?: string;
  laneModel?: string;
  synthesisModel?: string;
  repairModel?: string;
  visionModel?: string;
  maxTokens?: number;
  laneMaxTokens?: number;
  synthesisMaxTokens?: number;
  repairMaxTokens?: number;
}

interface FileModelConfig {
  claude?: PartialModelConfig;
  openai?: PartialModelConfig;
}

const CONFIG_FILE = path.join(__dirname, '..', 'config', 'models.json');

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function readFileConfig(provider: ProviderName): PartialModelConfig {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as FileModelConfig;
    return raw[provider] ?? {};
  } catch {
    return {};
  }
}

export function getModelConfig(provider: ProviderName): ModelConfig {
  const file = readFileConfig(provider);

  if (provider === 'claude') {
    return {
      provider,
      batchModel: process.env.MODEL_BATCH ?? process.env.MODEL ?? file.batchModel ?? 'claude-opus-4-8',
      laneModel: process.env.MODEL_LANE ?? file.laneModel ?? 'claude-opus-4-8',
      synthesisModel: process.env.MODEL_SYNTHESIS ?? file.synthesisModel ?? 'claude-opus-4-8',
      repairModel: process.env.MODEL_REPAIR ?? file.repairModel ?? 'claude-sonnet-5-5',
      visionModel: process.env.FIGURE_VLM_MODEL ?? file.visionModel ?? 'claude-opus-4-8',
      maxTokens: parsePositiveInt(process.env.MAX_TOKENS, file.maxTokens ?? 16384),
      laneMaxTokens: parsePositiveInt(process.env.LANE_MAX_TOKENS, file.laneMaxTokens ?? 16384),
      synthesisMaxTokens: parsePositiveInt(process.env.SYNTHESIS_MAX_TOKENS, file.synthesisMaxTokens ?? 16384),
      repairMaxTokens: parsePositiveInt(process.env.REPAIR_MAX_TOKENS, file.repairMaxTokens ?? 8192),
    };
  }

  return {
    provider,
    batchModel: process.env.MODEL_BATCH ?? process.env.MODEL ?? file.batchModel ?? 'gpt-5.6-terra',
    laneModel: process.env.MODEL_LANE ?? file.laneModel ?? 'gpt-5.6-luna',
    synthesisModel: process.env.MODEL_SYNTHESIS ?? file.synthesisModel ?? 'gpt-5.6-terra',
    repairModel: process.env.MODEL_REPAIR ?? file.repairModel ?? 'gpt-5.6-luna',
    visionModel: process.env.FIGURE_VLM_MODEL ?? file.visionModel ?? 'gpt-5.6-terra',
    maxTokens: parsePositiveInt(process.env.MAX_TOKENS, file.maxTokens ?? 8192),
    laneMaxTokens: parsePositiveInt(process.env.LANE_MAX_TOKENS, file.laneMaxTokens ?? 4096),
    synthesisMaxTokens: parsePositiveInt(process.env.SYNTHESIS_MAX_TOKENS, file.synthesisMaxTokens ?? 8192),
    repairMaxTokens: parsePositiveInt(process.env.REPAIR_MAX_TOKENS, file.repairMaxTokens ?? 8192),
  };
}

/** Prefix rule: `claude-` ids are Claude, `gemini-` ids are Gemini, all other ids belong to OpenAI. */
export function modelBelongsToProvider(model: string, provider: string): boolean {
  const owner = model.startsWith('claude-') ? 'claude' : model.startsWith('gemini-') ? 'gemini' : 'openai';
  return owner === provider;
}

function assertVisionModel(provider: ProviderName, model: string, envKnob: string): string {
  if (!modelBelongsToProvider(model, provider)) {
    throw new Error(`${envKnob} model "${model}" does not belong to vision provider "${provider}".`);
  }
  return model;
}

export function resolveVisionModel(provider: ProviderName): string {
  return assertVisionModel(provider, getModelConfig(provider).visionModel, 'FIGURE_VLM_MODEL');
}

export function resolveVisionVerifyModel(provider: ProviderName): string {
  return assertVisionModel(
    provider,
    process.env.FIGURE_VLM_VERIFY_MODEL ?? resolveVisionModel(provider),
    'FIGURE_VLM_VERIFY_MODEL',
  );
}

export function resolveFigureDataModel(provider: ProviderName): string {
  return assertVisionModel(
    provider,
    process.env.FIGURE_DATA_MODEL ?? resolveVisionModel(provider),
    'FIGURE_DATA_MODEL',
  );
}

export function laneCustomId(baseCustomId: string, lane: OpenAILane): string {
  return `${baseCustomId}::lane::${lane}`;
}

export function parseLaneCustomId(customId: string): { baseCustomId: string; lane: OpenAILane } | null {
  const match = customId.match(/^(.*)::lane::(methods|results|limitations|implications)$/);
  if (!match) return null;
  return { baseCustomId: match[1], lane: match[2] as OpenAILane };
}
