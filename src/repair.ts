import { canonicaliseExplainerJson, extractJson } from './output';
import { buildRepairInstruction, validateJsonOutput } from './quality';
import type { ProviderMessageResponse } from './providers';
import type { ExplainerJson } from './types/explainer-json';

export const MAX_REPAIR_ATTEMPTS = 2;

export interface RepairResult {
  text: string;
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
  let bestText = rawText;
  let bestIssueCount: number;

  try {
    const parsed = canonicaliseExplainerJson(extractJson(bestText) as ExplainerJson);
    const validation = validateJsonOutput(parsed, { expectedDate });
    if (validation.ok) return { text: bestText };
    bestIssueCount = validation.issues.length;
  } catch {
    return { text: bestText };
  }

  let usage: ProviderMessageResponse | undefined;

  for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const parsed = canonicaliseExplainerJson(extractJson(bestText) as ExplainerJson);
    const validation = validateJsonOutput(parsed, { expectedDate });
    console.warn(`  ⚠ JSON validation issues: ${validation.issues.join('; ')}`);

    const reply = await repair(buildRepairInstruction(validation.issues, expectedDate), bestText);
    usage = usage
      ? {
        ...reply,
        inputTokens: usage.inputTokens + reply.inputTokens,
        outputTokens: usage.outputTokens + reply.outputTokens,
      }
      : reply;

    try {
      const repaired = canonicaliseExplainerJson(extractJson(reply.text) as ExplainerJson);
      const repairedValidation = validateJsonOutput(repaired, { expectedDate });
      if (repairedValidation.issues.length < bestIssueCount) {
        bestText = reply.text;
        bestIssueCount = repairedValidation.issues.length;
        if (repairedValidation.ok) break;
      }
    } catch {
      // Keep the best parseable candidate and try another repair.
    }
  }

  return { text: bestText, usage };
}
