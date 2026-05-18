#!/usr/bin/env bash
# Launches the batch inside a detached tmux session via op-fetch.
# op-fetch resolves only the refs needed for the chosen route, sources
# OP_SERVICE_ACCOUNT_TOKEN itself (headless, no biometric), and exec's the
# child with sanitized env. Replaces the legacy op-run flow; the single
# source of truth for refs is op-refs.sh at the repo root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck disable=SC1091
source "${REPO_ROOT}/op-refs.sh"

PROVIDER="${PROVIDER:-openai}"
SESSION_NAME="${SESSION_NAME:-explainer-${PROVIDER}-batch}"
LOG_FILE="${LOG_FILE:-${TMPDIR:-/tmp}/${SESSION_NAME}.log}"
EXTRA_ARGS="${EXTRA_ARGS:-}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "error: tmux is not installed or not on PATH" >&2
  exit 1
fi

# 1Password is OPTIONAL. The secure route needs both an `op-fetch` resolver on
# PATH and a private op-refs.local.sh. If either is absent, fall back to running
# directly — the in-process fill-only .env loader supplies provider keys
# (see .env.example).
USE_OP_FETCH=1
if ! command -v op-fetch >/dev/null 2>&1 || [[ ! -f "${REPO_ROOT}/op-refs.local.sh" ]]; then
  USE_OP_FETCH=0
  echo "[run-batch-tmux] op-fetch/1Password not configured — running with .env (see .env.example)" >&2
fi

# Route -> ref mapping. Only fetch what the route actually uses.
#   openai (batch/API)   -> OPENAI_API_KEY
#   claude (batch/API)   -> ANTHROPIC_API_KEY
#   claude --sync        -> CLAUDE_CODE_OAUTH_TOKEN (Max/Pro OAuth)
#   openai --sync        -> nothing (Codex auth from ~/.codex/auth.json)
IS_SYNC=0
if [[ " ${EXTRA_ARGS} " == *" --sync "* ]]; then
  IS_SYNC=1
fi

OP_FETCH_ARGS=()
case "${PROVIDER}" in
  openai)
    if [[ "${IS_SYNC}" -eq 0 ]]; then
      OP_FETCH_ARGS+=( "OPENAI_API_KEY=${OP_REF_OPENAI_API_KEY}" )
    fi
    ;;
  claude)
    if [[ "${IS_SYNC}" -eq 1 ]]; then
      OP_FETCH_ARGS+=( "CLAUDE_CODE_OAUTH_TOKEN=${OP_REF_CLAUDE_CODE_OAUTH_TOKEN}" )
    else
      OP_FETCH_ARGS+=( "ANTHROPIC_API_KEY=${OP_REF_ANTHROPIC_API_KEY}" )
    fi
    ;;
  *)
    echo "error: unknown provider: ${PROVIDER}" >&2
    exit 1
    ;;
esac

# Build the in-tmux command. With op-fetch, even zero-secret routes go through
# it so parent-shell API keys cannot leak into Codex/ChatGPT auth paths.
# Without it, run npm directly — keys come from the fill-only .env loader.
RUN_PREFIX=""
if [[ "${USE_OP_FETCH}" -eq 1 ]]; then
  OP_FETCH_ARGS_STR=""
  if [[ "${#OP_FETCH_ARGS[@]}" -gt 0 ]]; then
    printf -v OP_FETCH_ARGS_STR '%q ' "${OP_FETCH_ARGS[@]}"
  fi
  RUN_PREFIX="op-fetch ${OP_FETCH_ARGS_STR}-- "
fi
INNER_CMD="cd \"${REPO_ROOT}\" && ${RUN_PREFIX}npm run process -- --provider \"${PROVIDER}\" ${EXTRA_ARGS} 2>&1 | tee \"${LOG_FILE}\""

tmux kill-session -t "${SESSION_NAME}" 2>/dev/null || true
tmux new-session -d -s "${SESSION_NAME}" "${INNER_CMD}"

echo "tmux session: ${SESSION_NAME}"
echo "log file: ${LOG_FILE}"
echo "follow logs: tail -f ${LOG_FILE}"
