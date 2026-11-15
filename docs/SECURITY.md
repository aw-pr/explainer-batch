# Security model

This repo is designed to be publishable: no secret, credential, vault name, or
machine-specific path lives in the committed tree.

## Credential resolution

Two independent, optional mechanisms. A clone works with either.

**`.env` (default, no extra tooling).** Copy `.env.example` to `.env` and set
the provider keys. At startup `src/env.ts` loads `.env.local` then `.env`
*fill-only*: a value is applied only if that variable is currently unset, so it
never overrides a real shell export or a key injected by the 1Password route.
`.env*` is gitignored except `.env.example`.

**1Password (optional).** When configured, credentials live in 1Password and
are resolved at the moment a child process starts; the repo holds only `op://`
*references*, never values. `op-refs.sh` (committed) carries placeholder
defaults and sources a gitignored `op-refs.local.sh` (copy
`op-refs.local.sh.example`) containing your real vault/item refs. The secure
wrapper `scripts/run-batch-tmux.sh` passes the named refs to an `op-fetch`
resolver on `PATH`, which sources the 1Password service-account token itself,
resolves **only** the refs the selected route needs, and `exec`s the child with
a sanitised environment. If `op-fetch` or `op-refs.local.sh` is absent the
wrapper falls back to running directly with the `.env` keys.

## Route isolation (no accidental API billing)

Each route fetches only the secrets it needs:

- Claude batch → `ANTHROPIC_API_KEY` only
- Claude sync → `CLAUDE_CODE_OAUTH_TOKEN` only (mixed OAuth + API-key env is
  rejected by the CLI to prevent silent API billing)
- OpenAI batch / API → `OPENAI_API_KEY` only
- OpenAI sync (Codex CLI) → no key fetched

## Publish guards

`scripts/install-guards.sh` arms the local git hooks in `scripts/git-hooks/`:

- **pre-commit**: refuses to stage `.env`, `*.local`, `op-refs.local.sh`,
  `*settings.local.json`, `state.json`, logs, and any content matching the
  personal regex patterns in a gitignored `.publish-guard.local` (seeded from
  `.publish-guard.local.example`). It also refuses any commit made directly on
  the publish branch, which advances only by fast-forward.
- **pre-merge-commit**: runs the same checks for merge commits, so a
  `--no-ff` merge onto the publish branch is refused too.
- **pre-push**: fail-closed publish gate. On the public remote (matched by
  the local `git config publishguard.publicmatch`) only the publish branch
  may be pushed, as the source of a pull request into the default branch, and
  its tree is scanned for private-tier files. A push to the default branch is
  refused: it advances only by merging that pull request on GitHub. (A repo
  that sets `publishguard.boundary direct` instead allows a default-branch push
  that carries the `PUBLISH_GUARD_OK=1` sentinel the `git publish` alias sets.)
  Other remotes (private backups) are unrestricted. Unset
  `publishguard.publicmatch` → the hook is inert. Deliberate one-off override:
  `git push --no-verify`.
- **commit-msg**: cosmetic; appends a vendor `Co-Authored-By` trailer for
  agent-authored commits. Not a guard.

  Why fail-closed, not a warning: publishing to a public remote is effectively
  irreversible (objects stay fetchable by SHA, content can be cached/indexed),
  so the gate stops the action and points at the correct command rather than
  narrating the mistake as it completes. Org/repo names live only in local
  `git config` (`publishguard.*`), never in the committed tree.

The end-to-end branching + publish model (orphan-squash base, the `publish`
line, topic-branch workflow, one-time setup for a new repo) is in
`docs/PUBLISH-WORKFLOW.md`.

Hooks are local and not transferred by clone; each contributor runs
`npm run guards:install` once. Override an individual block intentionally with
`--no-verify`.
