# HANDOFF

> **Status (2026-07-12):** VLM figure extraction and publish-workflow rework complete on `wip/vlm-figure-extraction` (30 atomic commits); holding for a live end-to-end run before merge to `publish`.

## Recent activity (2026-07-12 vlm-figure-extraction)

- Landed the VLM figure extraction rearchitecture: URL DOM-candidate choose flow, PDF two-pass zoom-refine, vision inputs capped at 2500px long edge, context-fed selection prompts, stateful retry, crop verification pass (`FIGURE_VLM_VERIFY=0` disables it), blank-crop guard (0.006 bytes/px + 48px min dimension).
- Caption/alt now only survive re-extraction when the same source figure is re-picked on retry.
- Durability pass across state and batch handling: atomic `state.json` writes with corrupt-file backup, merge-by-batch-id state writes, durable `synthesis_batch_id` with capped/backoff polling, sync runs persist `focusHint`/`imageOverride`, `install-guards.sh` fails closed, website-exporter spawns time out.
- `skill.md` (the explainer system prompt) restyled: British English, extended banned-word list, lowercase pill continuation phrases, punchline closers, em dashes purged from repo prose.
- Publish workflow narrative switched to preserve-mode: `wip/*` merges into `publish` keep atomic per-agent commits; squash is now a per-merge opt-out rather than the default. `AGENTS.md`, `CLAUDE.md`, and `docs/PUBLISH-WORKFLOW.md` updated to match; guard hooks were already current and armed, `historymode=preserve` set.
- tsc/build pass; figure extraction live-tested end-to-end (URL and PDF via reextract, crops inspected); state/quality fixes exercised by throwaway scripts. Full live pipeline run deliberately deferred until a real paper is available.
- User approved all review fixes and doc changes; publish is explicitly held pending the live test.

## Next run

- Live end-to-end explainer run before publish. Once it passes: `git switch publish && git merge --ff-only wip/vlm-figure-extraction && git publish` (preserve-mode, no squash).
- Deferred: `batch.ts` structural refactor (B10) — shared submit/poll/repair/lane helpers, `useSearch` drift, `synthesisModel` vs `batchModel` — recorded in `docs/plans/2026-07-12-review-execution-plan.md`.
- Deferred: figure-extraction niceties — per-page PDF point sizes, candidate-page shortlist, SVG crops. The blank-guard 0.006 threshold is the dial to revisit if a sparse but legitimate diagram is ever rejected.
- Watch the first live run for blank-guard false rejects and crop verification behaviour on the codex route. No other blocking open questions.
