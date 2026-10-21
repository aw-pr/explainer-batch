import { arxivSourceFigure } from '../src/figure-locator/arxiv-source';
import { parseLabel, formatLabel } from '../src/figure-locator/label';
import { writeAsset } from '../src/figure-locator/asset';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [id, text, outDir, flag, cacheRoot] = args;
  const label = text ? parseLabel(text) : null;
  if (!id || !label || !outDir || (args.length !== 3 && !(args.length === 5 && flag === '--cache-dir' && cacheRoot))) {
    console.error('Usage: figure-arxiv.ts <arxiv-id> "<label>" <out-dir> [--cache-dir <dir>]');
    process.exitCode = 2;
    return;
  }
  const result = await arxivSourceFigure(id, label, { cacheRoot });
  if (result.ok) {
    console.log(JSON.stringify(writeAsset(outDir, result.label, result.bytes, { provenance: 'arxiv-source', label: formatLabel(result.label) })));
  } else {
    console.log(JSON.stringify(result));
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
