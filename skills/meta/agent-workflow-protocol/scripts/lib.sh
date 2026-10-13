#!/usr/bin/env bash
# Shared helpers for the GitHub agent workflow (see ../SKILL.md).
# Usage: source <this skill's directory>/scripts/lib.sh   (run from inside the target repository)
# Requires: gh (authenticated), jq and Python 3 for portable date arithmetic.
#
# Defaults and helpers are defined below. AGENT_OVERRIDES may point at a key=value file.

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

utc_epoch() { python3 -c 'import datetime; print(int(datetime.datetime.now(datetime.timezone.utc).timestamp()))'; }
utc_plus() {
  python3 -c 'import datetime,re,sys
s=sys.argv[1]; m=re.match(r"(\d+)\s*(hour|hours|minute|minutes)s?", s)
if not m: raise SystemExit("bad duration: "+s)
n,u=int(m.group(1)),m.group(2)
delta=datetime.timedelta(hours=n) if u.startswith("hour") else datetime.timedelta(minutes=n)
print((datetime.datetime.now(datetime.timezone.utc)+delta).strftime("%Y-%m-%dT%H:%M:%SZ"))' "$1"
}

has_label() {
  local n=$1 kind=$2 label=$3
  gh "$kind" view "$n" --json labels --jq '.labels[].name' | grep -qx -- "$label"
}
lease_live() {
  local n=$1 exp
  exp=$(markers "$n" | awk '/agent:lease /{for(i=1;i<=NF;i++) if($i ~ /^expires=/){sub(/^expires=/,"",$i); print $i}}' | tail -1)
  [ -n "$exp" ] || return 1
  python3 -c 'import datetime,sys
exp=datetime.datetime.strptime(sys.argv[1],"%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
raise SystemExit(0 if datetime.datetime.now(datetime.timezone.utc)<exp else 1)' "$exp"
}
claim() {
  local n=$1 kind=$2 label=$3 step=$4 ttl=$5
  gh "$kind" edit "$n" --add-label "$label" >/dev/null
  gh "$kind" comment "$n" --body "<!-- agent:lease step=$step run=$RUN_ID expires=$(utc_plus "$ttl") -->" >/dev/null
}
renew() {
  local n=$1 kind=$2 step=$3 ttl=$4
  gh "$kind" comment "$n" --body "<!-- agent:lease step=$step run=$RUN_ID expires=$(utc_plus "$ttl") -->" >/dev/null
}
release() {
  local n=$1 kind=$2 label=$3
  gh "$kind" edit "$n" --remove-label "$label" >/dev/null 2>&1 || true
}

markers() {
  local n=$1
  { gh issue view "$n" --comments --json comments --jq '.comments[].body' 2>/dev/null
    gh pr view "$n" --comments --json comments --jq '.comments[].body' 2>/dev/null
  } | grep -oE '<!-- agent:[^>]+ -->' || true
}

review_rounds() {
  markers "$1" | grep -c 'agent:handoff kind=review' || true
}
shepherd_attempts() {
  markers "$1" | awk '
    /agent:handoff / { c=0; next }
    /agent:attempt step=shepherding/ { c++ }
    END { print c+0 }'
}
fail_item() {
  local n=$1 kind=$2 step=$3 reason=$4
  gh "$kind" comment "$n" --body "Failure ($step): $reason
<!-- agent:failure step=$step run=$RUN_ID -->" >/dev/null
}
failures() {
  local n=$1 step=$2
  markers "$n" | awk -v s="$step" '
    $0 ~ "agent:escalate step="s { c=0; next }
    $0 ~ "agent:failure step="s { c++ }
    END { print c+0 }'
}
open_findings() {
  markers "$1" | awk '
    /agent:attempt step=shepherding/ { o=0; next }
    /agent:handoff kind=merged/ { o=0; next }
    /agent:handoff kind=review/ {
      if (match($0, /open=([0-9]+)/, a)) o=a[1]+0; else o=1
    }
    END { print o+0 }'
}
ready_sha() {
  markers "$1" | awk '
    /agent:handoff kind=ready/ {
      if (match($0, /sha=([0-9a-fA-F]+)/, a)) sha=a[1]
    }
    END { print sha }'
}

prs_for_issue() {
  local n=$1
  gh pr list --state all --json number,state,headRefName,body --jq --argjson n "$n" '
    .[]
    | select(
        (.headRefName | test("(^|/)" + ($n|tostring) + "([-_/]|$)") )
        or (.body | test("(?i)(closes|fixes|resolves)[[:space:]]+#" + ($n|tostring) + "\\b"))
      )
    | "\(.number) \(.state)"
  ' 2>/dev/null || true
}
issue_for_pr() {
  local n=$1 body branch
  body=$(gh pr view "$n" --json body,headRefName --jq '.body' 2>/dev/null || true)
  branch=$(gh pr view "$n" --json headRefName --jq '.headRefName' 2>/dev/null || true)
  echo "$body" | grep -oiE '(closes|fixes|resolves)[[:space:]]+#[0-9]+' | grep -oE '[0-9]+' | head -1
  echo "$branch" | grep -oE '(^|/)[0-9]+([-_/]|$)' | grep -oE '[0-9]+' | head -1
}

log_issue() {
  local title num
  num=$(gh issue list --label agent:log --state open --json number,title --jq '.[0].number // empty' 2>/dev/null || true)
  if [ -z "$num" ]; then
    title="Agent log $(date -u +%Y-%m-%d)"
    num=$(gh issue create --title "$title" --body "Agent run log." --label agent:log --json number --jq .number 2>/dev/null || true)
  fi
  echo "$num"
}
log_run() {
  local file=$1 num
  num=$(log_issue)
  [ -n "$num" ] || return 0
  gh issue comment "$num" --body-file "$file" >/dev/null
}
read_logs() {
  local days=$1
  local num
  num=$(gh issue list --label agent:log --state all --limit 3 --json number --jq '.[].number' 2>/dev/null || true)
  for n in $num; do
    gh api "repos/{owner}/{repo}/issues/$n/comments" --paginate --jq '
      .[]
      | select(.body | test("\\*\\*Outcome:\\*\\*") and (test("nothing eligible") | not))
      | "---\n" + .body'
  done
}
