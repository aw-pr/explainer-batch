import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { OUTPUT_DIR, WEBSITE_REPO_ROOT } from './output';

export interface HtmlExportSummary {
  ok: number;
  failed: number;
  failures: Array<{ jsonPath: string; error: string }>;
}

function exporterScriptPath(): string | null {
  if (!WEBSITE_REPO_ROOT) return null;
  return path.join(WEBSITE_REPO_ROOT, 'scripts', 'export-explainer-html.mts');
}

export async function exportHtmlForJsonFiles(jsonPaths: string[]): Promise<HtmlExportSummary> {
  const uniquePaths = [...new Set(jsonPaths)].sort();
  if (uniquePaths.length === 0) {
    return { ok: 0, failed: 0, failures: [] };
  }

  const scriptPath = exporterScriptPath();
  if (!scriptPath) {
    // Website integration not configured — optional step, skip quietly.
    console.log('  · Website HTML export skipped (WEBSITE_REPO not set).');
    return { ok: 0, failed: 0, failures: [] };
  }

  if (!fs.existsSync(scriptPath)) {
    return {
      ok: 0,
      failed: uniquePaths.length,
      failures: uniquePaths.map((jsonPath) => ({
        jsonPath,
        error: `Website exporter not found at ${scriptPath}`,
      })),
    };
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const failures: Array<{ jsonPath: string; error: string }> = [];
  let ok = 0;

  for (const jsonPath of uniquePaths) {
    const outputPath = path.join(
      OUTPUT_DIR,
      path.basename(jsonPath).replace(/\.json$/, '.html'),
    );
    const result = spawnSync(
      process.execPath,
      [scriptPath, '--input', jsonPath, '--output', outputPath],
      { cwd: WEBSITE_REPO_ROOT as string, encoding: 'utf8' },
    );

    if (result.status === 0) {
      ok++;
      continue;
    }

    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    failures.push({
      jsonPath,
      error: details || `Exporter exited with status ${result.status ?? 'unknown'}`,
    });
  }

  return { ok, failed: failures.length, failures };
}
