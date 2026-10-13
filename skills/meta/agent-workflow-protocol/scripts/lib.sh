#!/usr/bin/env bash
# Shared helpers for the GitHub agent workflow (see ../SKILL.md).
# Usage: source <this skill's directory>/scripts/lib.sh
# Requires: gh (authenticated), jq, and Python 3.
# When a shell is unavailable, use GitHub MCP/connector tools for the same operations.

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

if [ -n "${AGENT_OVERRIDES:-}" ] && [ -f "${AGENT_OVERRIDES}" ]; then
  # shellcheck disable=SC1090
  source "${AGENT_OVERRIDES}"
fi

_config_pairs="
app_url:APP_URL
issues_per_run:ISSUES_PER_RUN
log_lookback_days:LOG_LOOKBACK_DAYS
dedupe_closed_days:DEDUPE_CLOSED_DAYS
pr_base_branch:PR_BASE_BRANCH
merge_method:MERGE_METHOD
human_reviewer:HUMAN_REVIEWER
build_cmd:BUILD_CMD
git_hooks_path:GIT_HOOKS_PATH
repo_guidance:REPO_GUIDANCE
lease_ttl_triage:LEASE_TTL_TRIAGE
lease_ttl_implement:LEASE_TTL_IMPLEMENT
lease_ttl_pr:LEASE_TTL_PR
groom_batch:GROOM_BATCH
implement_batch:IMPLEMENT_BATCH
shepherd_batch:SHEPHERD_BATCH
review_batch:REVIEW_BATCH
max_shepherd_attempts:MAX_SHEPHERD_ATTEMPTS
max_review_rounds:MAX_REVIEW_ROUNDS
max_item_failures:MAX_ITEM_FAILURES
"
while IFS=: read -r _lower _upper; do
  [ -n "$_lower" ] || continue
  eval "export $_upper=\${$_lower}"
done <<CONFIG_PAIRS
$_config_pairs
CONFIG_PAIRS
unset _config_pairs _lower _upper

RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${RUNNER_NAME:-local}}"
export RUN_ID
