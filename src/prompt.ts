import fs from 'fs';
import path from 'path';

const SKILL_FILE = path.join(__dirname, '..', 'skill.md');

/**
 * Strips YAML frontmatter (--- ... ---) from a markdown string
 * and returns the body.
 */
function stripFrontmatter(content: string): string {
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') return content;
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return content;
  return lines.slice(closeIdx + 1).join('\n').trimStart();
}

export function buildSystemPrompt(): string {
  return stripFrontmatter(fs.readFileSync(SKILL_FILE, 'utf8')).trimEnd()
    .replace(/^<!-- CONTRACT-V2-(?:BEGIN|END) -->\r?\n/gm, '');
}

export function buildUserInstruction(expectedDate: string, focusHint?: string, pinnedFigure?: string, citationKnown = false): string {
  const base = [
    'Create a JSON explainer for this paper following the skill instructions.',
    'Use the figures to understand the paper, but take every number from its text and tables. Put value grids (metric × system breakdowns) in `table` blocks; draw a chart only when every value in it is stated in the text or a table, per skill.md, and prefer a table when in doubt. Name the lead figure in `figure_request` (its label as the paper prints it and a one-sentence why), or set it to null. Never emit an `image` block: the figure pipeline locates and attaches the figure. Never invent figure content.',
    'When a visual detail is unclear, state the uncertainty or omit it rather than guessing.',
    citationKnown
      ? "The paper's citation is already known: set `citation` to null."
      : "Fill `citation` from the paper's front matter: the authors in order, the year, the full title, the venue and a URL.",
    'Return only a valid JSON object. The first character must be { and the last must be }. No code fences, no explanation.',
    ...(pinnedFigure !== undefined ? [`A sidecar pins ${pinnedFigure} as the lead figure; set \`figure_request.label\` to it and write \`why\` for it.`] : []),
  ].join(' ');

  const hint = focusHint?.trim();
  if (!hint) return base;

  const emphasis = [
    '',
    '',
    'READER EMPHASIS FOR THIS PAPER',
    hint,
    'Weight the pills, sections, and charts toward this angle where the paper supports it. If the paper does not cover it, do not invent content; stay faithful to the source.',
  ].join('\n');

  return base + emphasis;
}
