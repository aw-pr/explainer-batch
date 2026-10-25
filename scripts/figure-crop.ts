import { writeAsset } from '../src/figure-locator/asset';
import { parseLabel } from '../src/figure-locator/label';
import { cropPdfRegion, embeddedImagePpi, renderDpiFor } from '../src/figure-locator/pdf-crop';
import { locateRegion } from '../src/figure-locator/region';

const args = process.argv.slice(2);
if (args.length < 3 || args.length > 4 || args.slice(0, 3).some(a => a.startsWith('--')) ||
    (args.length === 4 && args[3] !== '--force-region-crop')) {
  console.error('Usage: figure-crop.ts <pdf> "<label>" <out-dir> [--force-region-crop]');
  process.exitCode = 2;
} else {
  const [pdf, label, outDir] = args;
  const result = locateRegion(pdf, label, { forceRegionCrop: args[3] === '--force-region-crop' });
  if (!result.ok) {
    console.log(JSON.stringify(result));
    process.exitCode = 1;
  } else {
    const ppi = result.provenance === 'pdf-embedded' ? embeddedImagePpi(pdf, result.page) : null;
    const crop = cropPdfRegion(pdf, result.page, result.cropBox, renderDpiFor(result.provenance, ppi));
    if (!crop) {
      console.log(JSON.stringify({ ok: false, reason: 'source-unavailable' }));
      process.exitCode = 1;
    } else {
      const record = writeAsset(outDir, parseLabel(result.label), crop.bytes,
        { page: result.page, provenance: result.provenance, label: result.label });
      console.log(JSON.stringify(record));
    }
  }
}
