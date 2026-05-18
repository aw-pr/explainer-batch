# AGENTS.md

Contract for AI coding agents (Claude Code, Codex CLI, any agentic coder)
working in this repo. User-facing docs live in `README.md`; this file is the
canonical source for **provider rules** and the **agent contract**. Claude Code
also reads `CLAUDE.md` for Claude-specific notes.

## What this repo is

A TypeScript CLI that turns research PDFs into structured JSON explainer
articles. Results land as `output/<slug>.json` (the canonical artefact) and an
optional standalone `output/<slug>.html`. A separate website repo consumes the
JSON via the shared type in `src/types/explainer-json.ts`.

## Provider rules (canonical — README links here)

Always pass `--provider` explicitly. With no flag and no `PROVIDER` env var the
code default is `claude`.

- **OpenAI sync via Codex CLI** — `npm run process -- --provider openai --sync`.
  Cheapest/fastest when Codex quota is available; no batch API needed. Codex
  strips PDF content before sending (model sees upstream-extracted text only —
  an accepted trade-off).
- **Claude max-plan sync** —
  `PROVIDER=claude EXTRA_ARGS=--sync SESSION_NAME=explainer-claude-sync npm run process:secure:tmux`.
  Uses `CLAUDE_CODE_OAUTH_TOKEN` via the Agent SDK; the wrapper fetches only the
  OAuth token, never an API key.
- **Claude batch** — `npm run process -- --provider claude`. `ANTHROPIC_API_KEY`,
  ~1h turnaround, 50% discount.
- **OpenAI batch** — `npm run process -- --provider openai`. `OPENAI_API_KEY`.
- **Never run `--provider claude --sync` with an API key.** It burns API credit
  with no batch discount. The CLI rejects mixed `CLAUDE_CODE_OAUTH_TOKEN` +
  `ANTHROPIC_API_KEY`; use the secure tmux route so only the OAuth token is
  present.

## Critical operational facts

- Commands live in `package.json`; CLI entry point is `src/index.ts`.
- `state.json` is auto-managed and gitignored — never hand-edit it.
- Secrets never go in source. `.env`/`.env.local` (fill-only) or the optional
  1Password route supply keys. See `docs/SECURITY.md`.
- `op-refs.sh` holds **placeholder** refs only; real refs live in gitignored
  `op-refs.local.sh`. Do not inline `op://` strings elsewhere.
- Any schema change to `ExplainerJson` must be mirrored in the consuming
  website repo's equivalent type. Break the contract and the renderer breaks.
- `skill.md` (after its YAML frontmatter) is the system prompt sent verbatim.
  Treat it as production code.
- Schema-drift fixes belong in `normalizeSchemaDrift` (`src/output.ts`), not in
  the prompt. OpenAI and Claude save paths are deliberately in sync.
- Input/output locations and integrations are parameterised
  (`EXPLAINER_INPUT_DIR`, `EXPLAINER_OUTPUT_DIR`, `WEBSITE_REPO`,
  `EXPLAINER_JOBS_DIR`); code degrades gracefully / uses repo defaults when
  unset.

## Publishing

This repo is a public mirror of private work. Do messy work on `wip/*`
branches, squash-merge into **`publish`**, then `git publish` (never hand-push
the default branch to the public remote — the pre-push gate blocks it by
design; route through `git publish`). Never rewrite commits already public.
Model + new-repo setup: `docs/PUBLISH-WORKFLOW.md`. Local-only operational
context: gitignored `LOCAL.md`. Portable pattern: `repo-publish-workflow` skill.

## Collaboration habits

- Small, focused commits with suggested commit messages.
- Flag risks and trade-offs before destructive operations.
- Ask one clarifying question when genuinely ambiguous; otherwise proceed.
- No invented file paths, function names, or flags — verify before recommending.
- Run `npm run guards:install` once per clone; never `--no-verify` to sneak
  machine-specific data into a commit.
