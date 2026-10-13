#!/usr/bin/env bash
# Shared helpers for the GitHub agent workflow (see ../SKILL.md).
# Usage: source <this skill's directory>/scripts/lib.sh
# Requires: gh (authenticated), jq, and Python 3.
#
# When a shell is unavailable, perform the same operations with GitHub MCP/connector tools.

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

export app_url issues_per_run log_lookback_days dedupe_closed_days
export pr_base_branch merge_method human_reviewer build_cmd git_hooks_path repo_guidance
export lease_ttl_triage lease_ttl_implement lease_ttl_pr
export groom_batch implement_batch shepherd_batch review_batch
export max_shepherd_attempts max_review_rounds max_item_failures

RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${RUNNER_NAME:-local}}"
export RUN_ID
