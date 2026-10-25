import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NormalizedResult } from '../src/llm-contract';

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMABgYGBgYGCgYGCg4KCgoOEg4ODg4SFxISEhISFxwXFxcXFxccHBwcHBwcHCIiIiIiIicnJycnLCwsLCwsLCwsLP/bAEMBBwcHCwoLEwoKEy4fGh8uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLv/dAAQAAf/aAAwDAQACEQMRAD8A86ooor44/pE//9k=',
  'base64',
);

async function main(): Promise<void> {
  const [input, ...flags] = process.argv.slice(2);
  if (!input || flags.some(flag => flag !== '--detected')) {
    throw new Error('Usage: smoke-contract.ts <wire.json> [--detected]');
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-contract-smoke-'));
  try {
    // Output paths are fixed when the seam's output module is first imported.
    Object.assign(process.env, {
      EXPLAINER_OUTPUT_DIR: path.join(temporary, 'output'),
      EXPLAINER_INPUT_DIR: path.join(temporary, 'input'),
      EXPLAINER_STATE_FILE: path.join(temporary, 'state.json'),
      EXPLAINER_OBSIDIAN_DIR: '', WEBSITE_REPO: '',
    });
    const { finalizeResult } = await import('../src/finalize');
    const text = fs.readFileSync(input, 'utf8');
    const checkpoints = new Map<string, unknown>();
    const receipt: NormalizedResult = {
      provider: 'openai', route: 'batch-api', stage: 'synthesis', model: 'offline-smoke',
      customId: 'smoke', attemptId: 'smoke-1', finishReason: 'stop', text,
      usage: { in: null, out: null, cacheRead: null, cacheWrite5m: null, cacheWrite1h: null, source: 'unavailable' },
    };
    const outcome = await finalizeResult('smoke', receipt, {
      stamp: {
        expectedDate: '2026-10-22',
        detectedReference: flags.includes('--detected') ? {
          authors: [{ family: 'Alenezi', given: 'M.' }], year: 2026,
          title: 'From Prompt-Response to Goal-Directed Systems: The Evolution of Agentic AI Software Architecture',
          venue: 'arXiv preprint', url: 'https://arxiv.org/abs/2602.10479',
        } : undefined,
      },
      checkpoints: { get: key => checkpoints.get(key), put: (key, value) => { checkpoints.set(key, value); } },
      figure: async wire => ({
        label: wire.figure_request!.label, caption: 'Offline fixture figure.',
        alt_text: 'A fixed one-pixel image for the offline smoke.', bytes: JPEG, provenance: 'vlm-crop',
      }),
    });
    if (outcome.status === 'errored') throw new Error(outcome.message);
    console.log(fs.readFileSync(outcome.jsonPath, 'utf8'));
    console.log(`repair attempts: ${outcome.repairAttempts}`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
