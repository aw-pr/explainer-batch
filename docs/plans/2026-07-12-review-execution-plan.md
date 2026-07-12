# Execution plan: 2026-07-12 review fixes

Source: full-repo code review + figure-extraction deep dive, session 2026-07-12.
Branch: `wip/vlm-figure-extraction` (has uncommitted changes: README.md,
docs/FIGURE-EXTRACTION.md, skill.md, src/figure-vlm.ts, src/output.ts — do not
lose these; they are part of the DOM-snap/env-knobs work in progress).

Commit style: atomic commits, author `Claude Fable 5 <claude-fable-5@local>`,
committer stays the user's global git identity. One logical change per commit.

## Workstream A — figure extraction (highest value)

A1. **URL path: DOM-candidate choose flow** (`src/figure-vlm.ts`).
Invert `extractFromUrl`: enumerate figure-like DOM elements (reuse the selector
from `snapToFigureElement`; drop `card` from the container regex), screenshot
each candidate element directly via Playwright element screenshots (min size
filter, cap ~12 candidates, downscale each to <=1568px long edge before
sending), send the labelled set to the VLM and ask it to *choose one* and
supply caption/alt/source_figure. Crop = re-screenshot the chosen element.
Keep the existing full-page bbox path only as fallback when no candidates
match. This removes bbox regression on URLs entirely.

A2. **Never send an oversized image to vision** (`src/figure-vlm.ts` /
`src/vision.ts`). Claude Opus-tier caps images at 2576px long edge and
downscales silently; a 2560x15000 full-page screenshot becomes ~330px wide.
Add a downscale step (sips on macOS, already used) capping any image sent via
`runVision` at ~2500px long edge; for the fallback full-page path, tile tall
pages into <=2500px-tall segments and map bbox back through the tile offset.

A3. **PDF path: two-pass zoom-refine** (`src/figure-vlm.ts:extractFromPdf`).
Pass 1 (existing thumbnails) picks the page + rough region. Pass 2 renders the
chosen page alone at ~1500px wide and asks for a tight bbox within that page,
excluding caption and body text. Crop from the pass-2 box. Then reduce
CROP_PAD default from 0.022 to ~0.005 (the refined box is trustworthy).

A4. **Selection relevance: pass explainer context.**
`output.ts:attachFigureImage` holds the full ExplainerJson; thread hero
headline, subtitle, section labels, and chart titles into
`extractFigureViaVlm` and the selection prompt. Add instruction: charts
already recreate the results figures, prefer a complementary conceptual
figure (architecture / pipeline / visual abstract).

A5. **Stateful retry.** The `avoidPrevious` retry prompt never says what was
picked before (fresh stateless call). Pass the failed selection (page,
source_figure, bbox) into the retry prompt so "pick a DIFFERENT figure" is
actionable.

A6. **Smaller selection fixes:** use `pageHint` from the focus sidecar to bias
the prompt when present; stamp/name page numbers per thumbnail so the returned
`page` index is reliable; in `snapToFigureElement` require minimum IoU ~0.1
before container/centre bonuses and prefer the smallest candidate above
threshold.

A7. **Crop verification pass.** After cropping, one cheap vision call: "does
this image show a single complete figure with no surrounding body text?
yes/no + reason". On no, retry with the reason fed back. Also relax/verify the
blank guard (0.02 bytes/px may false-reject sparse line diagrams).

## Workstream B — durability / correctness (from repo sweep)

B1. `src/state.ts:66-77` — atomic writes (temp file + rename); on parse
failure of existing state, back it up and refuse to silently continue with
empty state (or at minimum warn loudly and preserve the corrupt file).
B2. `src/batch.ts` read-modify-write races (`:481, :683-741`) — re-read state
immediately before each write, or merge by batch id instead of writing the
whole stale snapshot.
B3. `src/batch.ts:678-691, 1207-1214` — persist the synthesis batch id to
state as soon as it is created; add attempt caps / max duration + retry with
backoff on transient errors in both poll loops; check status once before the
first 3-minute sleep (`:1205`).
B4. `scripts/install-guards.sh:41` — remove the HEAD-branch fallback for
`publishbranch`; fail closed with an instructive error instead.
B5. `src/batch.ts:1129-1151` (`runSync`) — persist `focusHint` and
`imageOverride` into RequestState so `.focus.md` figure pins work on sync
runs (currently silently dropped on the default codex route).
B6. `src/output.ts:312-326` — split the try block: JSON parse/normalise
failures -> _error.txt path; `attachFigureImage` failures -> warn and save the
explainer without an image.
B7. `src/output.ts:299-310` — sanitise `metadata.filename_slug` (strip path
separators / `..`) before path.join.
B8. `src/html-export.ts:51-55` + `scripts/render-html.ts:33-43` — add
timeouts to the website-exporter spawnSync calls.
B9. Lower priority cleanups: `quality.ts:21-23` anchor check should accept any
attribute order (parse, don't string-match) and `:117` slug regex should allow
hyphenated surnames; `preprocess.ts:155` customId collision (detect + suffix);
dedupe `htmlToPlain` (output.ts) vs `stripHtml` (preprocess.ts); remove unused
`state.ts:83 getLatestPendingBatch`; add `pageHint` to
`state.ts RequestState.imageOverride` type.
B10. Deferred/optional (note in HANDOFF, don't block): batch.ts structural
refactor extracting shared submit/poll/repair/lane helpers (fixes drift:
`useSearch` computed differently at :780/:825 vs :1021/:1066; Claude sync uses
synthesisModel vs batch batchModel).

## Workstream C — skill.md style tightening

C1. Add hard rule: British English spelling throughout.
C2. Extend banned list: unlock, game-changer, cutting-edge, navigate the
complexities, testament to, tapestry.
C3. Pill descriptions: lowercase continuation phrases completing the number,
never standalone capitalised sentences.
C4. Voice paragraph: close sections/end_takeaway with a reversal or quiet
punchline, not a summary.

## Workstream D — em dash cleanup in repo docs

Replace em dashes in prose docs with comma, parenthesis, spaced hyphen, or
restructure (per Anthony's style rules). Scope: README.md,
docs/FIGURE-EXTRACTION.md, docs/*.md, and any other tracked prose markdown.
Do NOT touch: skill.md's explicit "no em dashes" *rules text* (keep the rules,
but the skill.md instructions themselves may keep necessary mentions of the —
character as a banned token), code comments are lower priority but clean where
touched, and do not alter code behaviour.

## Verification

- `npm run build` / `tsc` must pass after each workstream.
- Workstream A: run figure extraction end-to-end on one URL and one PDF
  (reextract script) and eyeball the crops.
- Workstream B: exercise a dry submit/poll where feasible; unit-style checks
  otherwise.
