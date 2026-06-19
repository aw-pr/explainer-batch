/**
 * Re-extract a figure from a PDF (or URL) and patch the image block on an
 * existing explainer JSON in place. Useful when you want to refresh the lead
 * figure without burning another synthesis batch.
 *
 * Figure selection is vision-driven (see src/figure-vlm.ts): the model looks at
 * the rendered document and picks the figure. Pass a figure label to pin a
 * specific one, or omit it to let the model choose. Routing/cost is controlled
 * by FIGURE_VLM_PROVIDER / FIGURE_VLM_ROUTE (subscription-first by default).
 *
 * Usage:
 *   npm run reextract -- <json> <pdf-or-url> [figure-label] [--caption "..."] [--alt "..."]
 *
 * Example:
 *   npm run reextract -- output/2026-05-21_liu_explainer.json input/2604.14228v1.pdf "Figure 3"
 */
import fs from 'fs';
import { extractFigureViaVlm } from '../src/figure-vlm';
import { loadDotEnv } from '../src/env';

loadDotEnv();

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
const [jsonPath, source, figureLabel] = positional;

if (!jsonPath || !source) {
  console.error('Usage: npm run reextract -- <json> <pdf-or-url> [figure-label] [--caption "..."] [--alt "..."]');
  process.exit(1);
}

const captionOverride = arg('--caption');
const altOverride = arg('--alt');
const isUrl = /^https?:\/\//i.test(source);

async function main(): Promise<void> {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Re-extracting ${figureLabel ? `"${figureLabel}"` : 'best figure'} from ${source}...`);

  const override = figureLabel || captionOverride || altOverride
    ? { source_figure: figureLabel ?? 'Figure', caption: captionOverride, alt_text: altOverride }
    : undefined;

  const result = await extractFigureViaVlm({
    pdfPath: isUrl ? null : source,
    url: isUrl ? source : null,
    override,
  });

  if (!result) {
    console.error('Extraction returned null — no usable figure found (check auth: FIGURE_VLM_ROUTE / subscription session).');
    process.exit(1);
  }

  const existing = data.image ?? {};
  data.image = {
    ...existing,
    source_figure: override?.source_figure ?? result.source_figure,
    caption: captionOverride ?? existing.caption ?? result.caption,
    alt_text: altOverride ?? existing.alt_text ?? result.alt_text,
    src: result.src,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`Patched ${jsonPath} via ${result.provider}/${result.route}${result.page ? ` p.${result.page}` : ''} (src ${result.src.length} chars)`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
