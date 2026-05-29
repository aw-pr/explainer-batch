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
  return stripFrontmatter(fs.readFileSync(SKILL_FILE, 'utf8')).trimEnd();
}

export function buildUserInstruction(expectedDate: string, focusHint?: string): string {
  const base = [
    'Create a JSON explainer for this paper following the skill instructions.',
    'Read the figures and tables as well as the prose. Put value grids (metric × system breakdowns) in `table` blocks; reserve Chart.js charts for genuine trends, relationships, or capability profiles per skill.md, and prefer a table over a bar chart when in doubt. If the paper has a single standout conceptual figure (visual abstract, architecture overview, taxonomy), emit it as an `image` block per skill.md; otherwise omit `image`. Never invent figure content.',
    'When a visual detail is unclear, state the uncertainty or omit it rather than guessing.',
    `Use ${expectedDate} as metadata.date_created and as the YYYY-MM-DD prefix of metadata.filename_slug (slug format: YYYY-MM-DD_authorsurname_short-title_explainer).`,
    'hero.publication_date must use the format "Published Month Year".',
    'Return only a valid JSON object. The first character must be { and the last must be }. No code fences, no explanation.',
  ].join(' ');

  const hint = focusHint?.trim();
  if (!hint) return base;

  const emphasis = [
    '',
    '',
    'READER EMPHASIS FOR THIS PAPER',
    hint,
    'Weight the pills, sections, and charts toward this angle where the paper supports it. If the paper does not cover it, do not invent content — stay faithful to the source.',
  ].join('\n');

  return base + emphasis;
}
