import { buildCaptionIndex } from '../src/figure-locator/captions';

const pdf = process.argv[2];
if (!pdf) {
  console.error('usage: figure-captions.ts <pdf>');
  process.exit(2);
}

try {
  for (const e of buildCaptionIndex(pdf)) {
    console.log(`p${e.page}\t${e.label}\t${e.text.split(' ').slice(0, 8).join(' ')}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
