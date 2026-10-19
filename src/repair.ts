import { canonicaliseExplainerJson, extractJson } from './output';
import { buildRepairInstruction, validateJsonOutput } from './quality';
import type { ProviderMessageResponse } from './providers';
import type { ExplainerJson } from './types/explainer-json';

export const MAX_REPAIR_ATTEMPTS = 2;

export interface RepairResult {
  html: string;
  usage?: ProviderMessageResponse;
}

interface RepairUntilValidOptions {
  rawText: string;
  expectedDate: string;
  repair: (system: string, text: string) => Promise<ProviderMessageResponse>;
}

export async function repairUntilValid({
  rawText,
  expectedDate,
  repair,
}: RepairUntilValidOptions): Promise<RepairResult> {
  let currentText = rawText;
  let usage: ProviderMessageResponse | undefined;

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    let parsed: ExplainerJson;
    try {
      parsed = canonicaliseExplainerJson(extractJson(currentText) as ExplainerJson);
    } catch {
      return { html: currentText };
    }

    const validation = validateJsonOutput(parsed, { expectedDate });
    if (validation.ok || attempt === MAX_REPAIR_ATTEMPTS) return { html: currentText, usage };

    console.warn(`  ⚠ JSON validation issues: ${validation.issues.join('; ')}`);
    usage = await repair(buildRepairInstruction(validation.issues, expectedDate), currentText);
    currentText = usage.text;
  }

  return { html: currentText, usage };
}
