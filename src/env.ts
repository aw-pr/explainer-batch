import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse a dotenv-style file into a flat key/value map. Blank lines and
 * `#` comments are skipped; surrounding single/double quotes are stripped.
 * Returns an empty map if the file does not exist.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    values[key] = value;
  }
  return values;
}

/**
 * Fill-only dotenv loader. Reads `.env.local` then `.env` from the repo root
 * and sets each key into `process.env` ONLY if it is currently unset.
 *
 * This never overrides a real shell export or a value injected by `op-fetch`
 * (which runs the child with a sanitised env + the resolved keys, so those
 * keys are already present and this is a no-op). `.env.local` wins over `.env`
 * because it is loaded first and the loader is fill-only.
 */
export function loadDotEnv(rootDir: string = path.join(__dirname, '..')): void {
  for (const fileName of ['.env.local', '.env']) {
    const parsed = parseEnvFile(path.join(rootDir, fileName));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
