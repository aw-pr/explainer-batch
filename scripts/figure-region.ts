import { locateRegion } from '../src/figure-locator/region';

const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3 || args[0].startsWith('--') || args[1].startsWith('--') ||
    (args.length === 3 && args[2] !== '--force-region-crop')) {
  console.error('Usage: figure-region.ts <pdf> "<label>" [--force-region-crop]');
  process.exitCode = 2;
} else {
  const result = locateRegion(args[0], args[1], { forceRegionCrop: args[2] === '--force-region-crop' });
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
