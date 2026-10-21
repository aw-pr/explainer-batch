import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cropPdfRegion } from './pdf-crop';
import type { Rect } from './geometry';
import { runVision, resolveVisionProvider } from '../vision';
import { resolveVisionModel } from '../model-config';

export const PICKER_SYSTEM = 'You are checking a figure crop for a research explainer. Reply with a single integer and nothing else.';
export const VERIFY_SYSTEM = 'You are checking a figure crop for a research explainer. Reply yes or no.';
export const VERIFY_PROMPT = 'Is this one complete figure with no body text? Reply yes or no.';

const MAX_CANDIDATES = 6;
const RENDER_DPI = 100;
const REPLY_MAX_TOKENS = 16;

export interface VisionRequest { system: string; prompt: string; imagePaths: string[]; labels: string[] }
export type VisionFn = (req: VisionRequest) => Promise<string>;

export interface PickInput {
  label: string;
  captionText: string;
  candidates: Array<{ image: string; region: Rect }>;
  pageImage?: string;
  page?: number;
  pinned: boolean;
}

export type PickResult =
  | { ok: true; index: number; via: 'single' | 'picker' | 'largest'; calls: { picker: number; verify: number }; notes: string[] }
  | { ok: false; reason: 'picker-declined' | 'picker-unavailable' | 'verify-rejected'; calls: { picker: number; verify: number }; notes: string[] };

function stripFence(reply: string): string {
  const fenced = reply.trim().match(/^```[^\n`]*\n([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : reply).trim();
}

export function parsePick(reply: string, count: number): number | null {
  const match = stripFence(reply).match(/^\s*(\d+)\s*$/);
  if (!match) return null;
  const n = Number(match[1]);
  return n <= count ? n : null;
}

export function pickerPrompt(label: string, captionText: string, count: number, withPage: boolean): string {
  return `The caption on this page reads: ${captionText}. Candidates 1 to ${count} are regions beside that caption${withPage ? '; the last image is the page' : ''}. Which candidate is the complete body of ${label} (every panel, axis and legend, no body text, no other figure)? Reply with the candidate number, or 0 if none is complete.`;
}

function area(r: Rect): number {
  return (r.x1 - r.x0) * (r.y1 - r.y0);
}

function verifyPasses(reply: string): boolean {
  return stripFence(reply).replace(/\.$/, '').toLowerCase() === 'yes';
}

export async function pickRegion(
  input: PickInput,
  vision: VisionFn = runPickerVision,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PickResult> {
  if (input.candidates.length === 0) throw new Error('pickRegion: no candidates');
  if (input.candidates.length === 1) {
    return { ok: true, index: 0, via: 'single', calls: { picker: 0, verify: 0 }, notes: [] };
  }
  const sent = input.candidates.slice(0, MAX_CANDIDATES);
  const calls = { picker: 1, verify: 0 };
  const labels = sent.map((_, i) => `Candidate ${i + 1}`);
  const imagePaths = sent.map(c => c.image);
  if (input.pageImage) {
    imagePaths.push(input.pageImage);
    labels.push(input.page === undefined ? 'Page' : `Page ${input.page}`);
  }

  let pick: number | null = null;
  try {
    const reply = await vision({
      system: PICKER_SYSTEM,
      prompt: pickerPrompt(input.label, input.captionText, sent.length, Boolean(input.pageImage)),
      imagePaths,
      labels,
    });
    pick = parsePick(reply, sent.length);
  } catch {
    pick = null;
  }

  if (pick === 0) return { ok: false, reason: 'picker-declined', calls, notes: [] };
  if (pick === null) {
    if (input.pinned) return { ok: false, reason: 'picker-unavailable', calls, notes: [] };
    let index = 0;
    sent.forEach((c, i) => { if (area(c.region) > area(sent[index].region)) index = i; });
    return { ok: true, index, via: 'largest', calls, notes: ['picker-unavailable: largest region taken'] };
  }

  const index = pick - 1;
  if (env.FIGURE_VERIFY === '1') {
    calls.verify = 1;
    let passed = false;
    try {
      passed = verifyPasses(await vision({
        system: VERIFY_SYSTEM,
        prompt: VERIFY_PROMPT,
        imagePaths: [sent[index].image],
        labels: [`Candidate ${pick}`],
      }));
    } catch {
      passed = false;
    }
    if (!passed) return { ok: false, reason: 'verify-rejected', calls, notes: [] };
  }
  return { ok: true, index, via: 'picker', calls, notes: [] };
}

export async function runPickerVision(req: VisionRequest): Promise<string> {
  const provider = resolveVisionProvider();
  const res = await runVision({
    provider,
    model: resolveVisionModel(provider),
    maxTokens: REPLY_MAX_TOKENS,
    system: req.system,
    prompt: req.prompt,
    imagePaths: req.imagePaths,
    labels: req.labels,
  });
  return res.text;
}

export function renderPickerImages(
  pdfPath: string,
  page: number,
  regions: Rect[],
  dir: string,
): { candidates: string[]; page: string } | null {
  if (!fs.existsSync(pdfPath)) return null;
  fs.mkdirSync(dir, { recursive: true });
  const candidates: string[] = [];
  for (let i = 0; i < regions.length; i++) {
    const crop = cropPdfRegion(pdfPath, page, regions[i], RENDER_DPI);
    if (!crop) return null;
    const file = path.join(dir, `candidate-${i}.jpg`);
    fs.writeFileSync(file, crop.bytes);
    candidates.push(file);
  }
  const prefix = path.join(dir, 'page');
  const run = spawnSync('pdftoppm', [
    '-jpeg', '-r', String(RENDER_DPI), '-f', String(page), '-l', String(page), '-singlefile', pdfPath, prefix,
  ], { encoding: 'utf8' });
  if (run.error || run.status !== 0 || !fs.existsSync(`${prefix}.jpg`)) return null;
  return { candidates, page: `${prefix}.jpg` };
}
