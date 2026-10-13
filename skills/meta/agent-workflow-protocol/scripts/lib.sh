#!/usr/bin/env bash
# Shared helpers for the GitHub agent workflow (see ../SKILL.md).
# Usage: source <this skill's directory>/scripts/lib.sh   (run from inside the target repository)
# Requires: gh (authenticated), jq, and Python 3 for portable date arithmetic.
#
# Full implementation lives on main under the previous path; this stub keeps validate
# and no-shell runners working while the complete helper library is restored.
# Prefer performing the same operations with GitHub MCP/connector tools when no shell is available.

AGENT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${app_url:=}"
: "${issues_per_run:=5}"
: "${log_lookback_days:=14}"
: "${dedupe_closed_days:=30}"
: "${pr_base_branch:=main}"
: "${merge_method:=squash}"
: "${human_reviewer:=}"
: "${build_cmd:=}"
: "${git_hooks_path:=}"
: "${repo_guidance:=AGENTS.md}"
: "${lease_ttl_triage:=1 hour}"
: "${lease_ttl_implement:=3 hours}"
: "${lease_ttl_pr:=1 hour}"
: "${groom_batch:=5}"
: "${implement_batch:=1}"
: "${shepherd_batch:=3}"
: "${review_batch:=3}"
: "${max_shepherd_attempts:=3}"
: "${max_review_rounds:=3}"
: "${max_item_failures:=3}"

RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${RUNNER_NAME:-local}}"
export RUN_ID

echo "lib.sh: loaded defaults; RUN_ID=$RUN_ID" >&2
# Callers without a full helper set should use GitHub tools directly for claim/release/log operations.
