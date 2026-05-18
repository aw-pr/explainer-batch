#!/usr/bin/env bash
# Single source of truth for this repo's 1Password references.
# Committed. Refs are pointers, not secrets. Do not inline op:// strings elsewhere.
#
# 1Password is OPTIONAL. If you do not use 1Password, ignore this file and put
# provider keys in `.env` instead (see .env.example) — they are loaded fill-only.
#
# If you DO use 1Password: copy op-refs.local.sh.example to op-refs.local.sh
# (gitignored) and put your real vault/item refs there. The placeholders below
# are only defaults so the committed tree contains no private vault names.
#
# Wrappers source this file and pass the named refs to `op-fetch`, e.g.:
#   source "$(dirname "$0")/op-refs.sh"
#   exec op-fetch ANTHROPIC_API_KEY="$OP_REF_ANTHROPIC_API_KEY" -- "$@"
: "${OP_REF_OPENAI_API_KEY:=op://YOUR_VAULT/openai-api-key/credential}"
: "${OP_REF_ANTHROPIC_API_KEY:=op://YOUR_VAULT/anthropic-api-key/credential}"
: "${OP_REF_CLAUDE_CODE_OAUTH_TOKEN:=op://YOUR_VAULT/claude-oauth-token/credential}"

_op_refs_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[ -f "$_op_refs_here/op-refs.local.sh" ] && source "$_op_refs_here/op-refs.local.sh"
unset _op_refs_here

export OP_REF_OPENAI_API_KEY OP_REF_ANTHROPIC_API_KEY OP_REF_CLAUDE_CODE_OAUTH_TOKEN
