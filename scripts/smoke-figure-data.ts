/**
 * Offline smoke test for the figure-data recreation pass. Exercises the
 * tier-0 supplied-data path, the neutral-shape → ECharts mapper, and the
 * ECharts SSR render, with no vision call and no batch run:
 *
 *   npx ts-node scripts/smoke-figure-data.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as echarts from 'echarts';
import { recreateFigureData } from '../src/figure-data';

async function main(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'figdata-smoke-'));
  const csv = [
    'Training steps,Baseline,With curriculum',
    '1000,12.1,14.9',
    '2000,18.4,24.2',
    '3000,22.0,30.8',
    '4000,24.6,35.1',
    '5000,26.1,38.4',
    '6000,27.0,40.2',
  ].join('\n');
  fs.writeFileSync(path.join(tmpDir, 'sample.csv'), csv, 'utf8');

  const fig = await recreateFigureData({
    directive: { enabled: true, target: 'Figure 2', dataFile: 'sample.csv' },
    inputDir: tmpDir,
    sourceFigure: 'Figure 2',
  });
  if (!fig) throw new Error('tier-0 recreation returned null');
  if (fig.data_provenance !== 'supplied') throw new Error(`expected supplied provenance, got ${fig.data_provenance}`);
  if (fig.series.length !== 2 || fig.series[0].values?.length !== 6) {
    throw new Error(`unexpected series shape: ${JSON.stringify(fig.series.map(s => ({ name: s.name, n: s.values?.length })))}`);
  }
  console.log('✓ tier-0 supplied-data recreation:');
  console.log(JSON.stringify({ ...fig, echarts_option: '(…)' }, null, 2));

  // SSR render of the generated option, mirroring the verify pass.
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 900, height: 560 });
  chart.setOption({ animation: false, ...(fig.echarts_option as Record<string, unknown>) });
  const svg = chart.renderToSVGString();
  chart.dispose();
  if (!svg.includes('<svg')) throw new Error('SSR render produced no SVG');
  const svgPath = path.join(tmpDir, 'recreated.svg');
  fs.writeFileSync(svgPath, svg, 'utf8');
  console.log(`✓ ECharts SSR render OK (${Math.round(svg.length / 1024)}KB SVG) → ${svgPath}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('✓ smoke-figure-data passed');
}

main().catch(err => {
  console.error(`✗ smoke-figure-data failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
