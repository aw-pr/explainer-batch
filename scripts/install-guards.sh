#!/usr/bin/env bash
# Idempotent installer for the publish guards. Re-runnable; only fills gaps.
# Arms .git/hooks/{pre-commit,pre-push} from scripts/git-hooks/ and seeds a
# gitignored .publish-guard.local from the committed .example.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
hooks_src="scripts/git-hooks"
hooks_dst="$(git rev-parse --git-path hooks)"
mkdir -p "$hooks_dst"

for hook in pre-commit pre-push; do
  if [ -f "$hooks_dst/$hook" ] && ! cmp -s "$hooks_src/$hook" "$hooks_dst/$hook"; then
    echo "install-guards: existing $hook differs — backing up to $hook.bak"
    cp "$hooks_dst/$hook" "$hooks_dst/$hook.bak"
  fi
  install -m 0755 "$hooks_src/$hook" "$hooks_dst/$hook"
  echo "install-guards: armed $hook"
done

if [ ! -f .publish-guard.local ]; then
  cp .publish-guard.local.example .publish-guard.local
  echo "install-guards: seeded .publish-guard.local — edit it with your real patterns"
else
  echo "install-guards: .publish-guard.local already present — left untouched"
fi

echo "install-guards: done."
