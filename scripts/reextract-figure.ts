/**
 * Re-extract a figure from a PDF and patch the image block on an existing
 * explainer JSON in place. Useful when figure-extract.ts changes and you
 * want to apply the new crop without burning another batch.
 *
 * Usage:
 *   npm run reextract -- <json> <pdf> <figure-label> [--page <n>] [--caption "..."] [--alt "..."]
 *
 * Example:
 *   npm run reextract -- output/2026-05-21_liu_explainer.json input/2604.14228v1.pdf "Figure 3" --page 8
 */
import fs from 'fs';
import { extractFigureAsDataUrl } from '../src/figure-extract';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

const positional = process.argv.slice(2).filter((a, i, all) => {
  if (a.startsWith('--')) return false;
  const prev = all[i - 1];
  if (prev && prev.startsWith('--')) return false;
  return true;
});
const [jsonPath, pdfPath, figureLabel] = positional;

if (!jsonPath || !pdfPath || !figureLabel) {
  console.error('Usage: npm run reextract -- <json> <pdf> <figure-label> [--page <n>] [--caption "..."] [--alt "..."]');
  process.exit(1);
}

const pageHintRaw = arg('--page');
const pageHint = pageHintRaw !== undefined ? Number(pageHintRaw) : undefined;
if (pageHint !== undefined && (!Number.isInteger(pageHint) || pageHint <= 0)) {
  console.error(`--page must be a positive integer (got ${pageHintRaw})`);
  process.exit(1);
}
const captionOverride = arg('--caption');
const altOverride = arg('--alt');

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
console.log(`Re-extracting "${figureLabel}" from ${pdfPath}${pageHint ? ` (page ${pageHint})` : ''}...`);

const src = extractFigureAsDataUrl(pdfPath, figureLabel, { pageHint });
if (!src) {
  console.error('Extraction returned null - check the figure label and (if vector) the page hint.');
  process.exit(1);
}

const existing = data.image ?? {};
data.image = {
  ...existing,
  source_figure: figureLabel,
  caption: captionOverride ?? existing.caption ?? `${figureLabel} from the source paper.`,
  alt_text: altOverride ?? existing.alt_text ?? `${figureLabel} from the source paper.`,
  src,
};

fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
console.log(`Patched ${jsonPath} (src ${src.length} chars)`);
