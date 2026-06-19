import fs from 'fs';
import path from 'path';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ClaudeProvider,
  OpenAIProvider,
  parseOpenAIAuthMode,
  type ProviderMessageResponse,
  type ProviderName,
} from './providers';

/**
 * Provider-agnostic single-shot vision call used by figure selection.
 *
 * Routing policy (the whole point of this module): subscription credits are
 * cheaper for the user, so `auto` prefers the subscription route (Claude OAuth
 * via the Agent SDK; OpenAI via the codex CLI) and only falls back to the
 * metered API when no subscription session is present. The route can be pinned
 * with FIGURE_VLM_ROUTE for testing or when the user explicitly wants the API.
 */
export type VisionRoute = 'auto' | 'subscription' | 'api';

export interface VisionResult extends ProviderMessageResponse {
  /** Which billing route actually serviced the call. */
  route: 'subscription' | 'api';
  provider: ProviderName;
}

function mediaTypeFor(imagePath: string): 'image/png' | 'image/jpeg' {
  return /\.jpe?g$/i.test(imagePath) ? 'image/jpeg' : 'image/png';
}

function hasClaudeOAuth(): boolean {
  return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
}

function hasAnthropicApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function resolveRoute(): VisionRoute {
  const raw = (process.env.FIGURE_VLM_ROUTE ?? 'auto').toLowerCase();
  if (raw === 'subscription' || raw === 'api') return raw;
  return 'auto';
}

/** Decide subscription vs api for Claude, honouring the explicit pin. */
function claudeRoute(route: VisionRoute): 'subscription' | 'api' {
  if (route === 'subscription') return 'subscription';
  if (route === 'api') return 'api';
  // auto: prefer OAuth subscription unless only an API key is configured.
  if (hasClaudeOAuth()) return 'subscription';
  if (hasAnthropicApiKey()) return 'api';
  throw new Error(
    'Claude vision auth not configured. Export CLAUDE_CODE_OAUTH_TOKEN for the ' +
    'subscription route, or set ANTHROPIC_API_KEY for the API route.',
  );
}

function openaiRoute(route: VisionRoute): 'subscription' | 'api' {
  const mode = parseOpenAIAuthMode();
  if (route === 'subscription') {
    if (mode !== 'codex_cli') {
      throw new Error('FIGURE_VLM_ROUTE=subscription requires codex ChatGPT auth (~/.codex/auth.json).');
    }
    return 'subscription';
  }
  if (route === 'api') {
    if (mode !== 'api_key') {
      throw new Error('FIGURE_VLM_ROUTE=api requires OPENAI_API_KEY (env or ~/.codex/auth.json).');
    }
    return 'api';
  }
  // auto: prefer codex subscription, fall back to API key.
  if (mode === 'codex_cli') return 'subscription';
  if (mode === 'api_key') return 'api';
  throw new Error('OpenAI vision auth not configured. Log in with codex ChatGPT auth or set OPENAI_API_KEY.');
}

function buildClaudeContent(prompt: string, imagePaths: string[]): Anthropic.MessageParam['content'] {
  const blocks: Anthropic.ContentBlockParam[] = [{ type: 'text', text: prompt }];
  for (const p of imagePaths) {
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaTypeFor(p),
        data: fs.readFileSync(p).toString('base64'),
      },
    });
  }
  return blocks;
}

function buildOpenAIInput(prompt: string, imagePaths: string[]): Array<{ role: 'user'; content: Array<Record<string, unknown>> }> {
  const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: prompt }];
  for (const p of imagePaths) {
    const dataUrl = `data:${mediaTypeFor(p)};base64,${fs.readFileSync(p).toString('base64')}`;
    content.push({ type: 'input_image', image_url: dataUrl });
  }
  return [{ role: 'user', content }];
}

export interface VisionCallOptions {
  provider: ProviderName;
  model: string;
  maxTokens: number;
  system: string;
  prompt: string;
  imagePaths: string[];
}

/**
 * Runs a single-shot vision completion and returns the raw model text plus the
 * route used. Caller parses the JSON. Throws on auth/transport failure so the
 * figure step can fall back to dropping the image block.
 */
export async function runVision(opts: VisionCallOptions): Promise<VisionResult> {
  const present = opts.imagePaths.filter(p => fs.existsSync(p));
  if (present.length === 0) throw new Error('runVision: no readable image paths');
  const route = resolveRoute();

  if (opts.provider === 'claude') {
    const decided = claudeRoute(route);
    const content = buildClaudeContent(opts.prompt, present);
    if (decided === 'subscription') {
      const provider = new ClaudeProvider();
      const res = await provider.createMessageViaCli(opts.model, opts.system, content);
      return { ...res, route: 'subscription', provider: 'claude' };
    }
    const provider = new ClaudeProvider(process.env.ANTHROPIC_API_KEY);
    const res = await provider.createMessageWithContent(opts.model, opts.maxTokens, opts.system, content);
    return { ...res, route: 'api', provider: 'claude' };
  }

  const decided = openaiRoute(route);
  const provider = new OpenAIProvider();
  if (decided === 'subscription') {
    const flat = `${opts.system}\n\n${opts.prompt}`;
    const res = await provider.createVisionViaCodex(opts.model, flat, present);
    return { ...res, route: 'subscription', provider: 'openai' };
  }
  const input = buildOpenAIInput(opts.prompt, present);
  const res = await provider.createMessage(opts.model, opts.maxTokens, opts.system, input);
  return { ...res, route: 'api', provider: 'openai' };
}

/** Resolves which provider services figure vision, independent of the synthesis run. */
export function resolveVisionProvider(): ProviderName {
  const raw = (process.env.FIGURE_VLM_PROVIDER ?? '').toLowerCase();
  if (raw === 'openai') return 'openai';
  if (raw === 'claude') return 'claude';
  // No explicit pin: prefer whichever subscription session is present, Claude first.
  if (hasClaudeOAuth()) return 'claude';
  if (parseOpenAIAuthMode() === 'codex_cli') return 'openai';
  if (hasAnthropicApiKey()) return 'claude';
  if (parseOpenAIAuthMode() === 'api_key') return 'openai';
  return 'claude';
}

/** True when at least one vision route is configured — lets callers skip silently otherwise. */
export function visionAuthAvailable(): boolean {
  return hasClaudeOAuth() || hasAnthropicApiKey() || parseOpenAIAuthMode() !== 'none';
}

export function cleanupTmp(dir: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
    fs.rmdirSync(dir);
  } catch { /* ignore */ }
}
