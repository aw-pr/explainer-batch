import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { OUTPUT_DIR, WEBSITE_REPO_ROOT } from '../src/output';

function usage(): never {
  console.error('Usage: ts-node scripts/render-html.ts <input.json> [--out <output.html>]');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

const inputPath = path.resolve(args[0]);
const outFlagIdx = args.indexOf('--out');
const outputPath = outFlagIdx !== -1 && args[outFlagIdx + 1]
  ? path.resolve(args[outFlagIdx + 1])
  : path.join(OUTPUT_DIR, path.basename(inputPath).replace(/\.json$/, '.html'));

if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

if (!WEBSITE_REPO_ROOT) {
  console.error(
    'WEBSITE_REPO is not set. Standalone HTML rendering uses the consuming\n' +
    'website repo\'s exporter. Set WEBSITE_REPO=/path/to/website-repo and retry.',
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    path.join(WEBSITE_REPO_ROOT, 'scripts', 'export-explainer-html.mts'),
    '--input',
    inputPath,
    '--output',
    outputPath,
  ],
  { cwd: WEBSITE_REPO_ROOT, encoding: 'utf8' },
);

if (result.status !== 0) {
  const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
  console.error(details || `Export failed with status ${result.status ?? 'unknown'}`);
  process.exit(result.status ?? 1);
}

console.log(`Wrote ${outputPath}`);
