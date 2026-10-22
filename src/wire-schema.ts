import fs from 'fs';
import path from 'path';

export function wireSchema(provider: 'claude' | 'openai'): Record<string, unknown> {
  const file = path.join(__dirname, '..', 'contract', 'generated', `model-output.${provider}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** Default ON. Set STRUCTURED_OUTPUT=0 to fall back to unenforced JSON output. */
export function structuredOutputEnabled(): boolean {
  return process.env.STRUCTURED_OUTPUT !== '0';
}
