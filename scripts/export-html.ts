import fs from 'fs';
import path from 'path';
import { exportHtmlForJsonFiles } from '../src/html-export';

function usage(): never {
  console.error('Usage: ts-node scripts/export-html.ts [--input-dir <dir>]');
  process.exit(1);
}

const args = process.argv.slice(2);
const inputDirFlag = args.indexOf('--input-dir');
const inputDir = inputDirFlag !== -1 && args[inputDirFlag + 1]
  ? path.resolve(args[inputDirFlag + 1])
  : path.resolve(__dirname, '..', 'output');

if (args.length > 0 && inputDirFlag === -1) usage();
if (!fs.existsSync(inputDir)) {
  console.error(`Input directory not found: ${inputDir}`);
  process.exit(1);
}

const jsonPaths = fs.readdirSync(inputDir)
  .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
  .sort()
  .map((name) => path.join(inputDir, name));

async function main() {
  const summary = await exportHtmlForJsonFiles(jsonPaths);
  console.log(`HTML export complete: ${summary.ok} written, ${summary.failed} failed`);
  if (summary.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
