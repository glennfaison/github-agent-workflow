#!/usr/bin/env bash
# Shared helpers for the GitHub agent workflow (see ../SKILL.md).
# Usage: source <this skill's directory>/scripts/lib.sh   (run from inside the target repository)
# Requires: gh (authenticated), jq, and Node.js. Dates, run ids and comment shapes come from
# helpers.mjs, so this file and the no-shell reference cannot disagree about them.
#
# There is no config file. Every default this library needs is set here, by name, and the same
# names are the keys a run may override: pass them as key=value pairs on a line of its own, or
# export them first. Whatever the run does not set falls back to the default below, exactly as
# ../SKILL.md's Defaults table describes.
#
# Helpers: has_label lease_live claim renew release            leases
#          markers review_rounds shepherd_attempts failures    reading markers
#          open_findings ready_sha fail_item                   handoffs and failures
#          prs_for_issue issue_for_pr                          issue <-> PR links
#          log_issue log_run difficulty_issue read_logs        run log
# Every marker is read through trusted_jq / _trusted_logins: a marker written by an account that is
# not trusted (see "Trust" in ../SKILL.md) is ignored.

AGENT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_HELPERS="$AGENT_LIB_DIR/helpers.mjs"
AGENT_ROOT="$(git rev-parse --show-toplevel)"

# ---- Defaults ---------------------------------------------------------------
: "${app_url:=}"
: "${explore_batch:=${issues_per_run:-5}}"      # issues_per_run is the deprecated name
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
: "${triage_batch:=${groom_batch:-5}}"          # groom_batch is the deprecated name
: "${implement_batch:=1}"
: "${shepherd_batch:=3}"
: "${review_batch:=3}"
: "${max_shepherd_attempts:=3}"
: "${max_review_rounds:=3}"
: "${max_item_failures:=3}"
: "${runner:=unknown}"
: "${unattended:=true}"
: "${trusted_authors:=}"

if [ -n "${AGENT_OVERRIDES:-}" ] && [ -f "${AGENT_OVERRIDES}" ]; then
  # shellcheck disable=SC1090
  source "${AGENT_OVERRIDES}"
fi

_config_pairs="
app_url:APP_URL
explore_batch:EXPLORE_BATCH
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
triage_batch:TRIAGE_BATCH
implement_batch:IMPLEMENT_BATCH
shepherd_batch:SHEPHERD_BATCH
review_batch:REVIEW_BATCH
max_shepherd_attempts:MAX_SHEPHERD_ATTEMPTS
max_review_rounds:MAX_REVIEW_ROUNDS
max_item_failures:MAX_ITEM_FAILURES
runner:RUNNER
unattended:UNATTENDED
trusted_authors:TRUSTED_AUTHORS
"
while IFS=: read -r _lower _upper; do
  [ -n "$_lower" ] || continue
  eval "export $_upper=\${$_lower}"
done <<CONFIG_PAIRS
$_config_pairs
CONFIG_PAIRS
unset _config_pairs _lower _upper

# ---- Dates and run ids (helpers.mjs) -----------------------------------------

utc_epoch() { node "$AGENT_HELPERS" utc-epoch "$1"; }
utc_plus()  { node "$AGENT_HELPERS" utc-plus "$1"; }

RUN_ID="${RUN_ID:-$(node "$AGENT_HELPERS" run-id "$runner")}"
export RUN_ID

# ---- Trust ---------------------------------------------------------------------
# A marker counts only when its author is trusted: the repository's OWNER, MEMBER or COLLABORATOR
# accounts, the account this agent runs as, or a login in $trusted_authors (comma-separated).

_agent_self() {
  [ -n "${_AGENT_SELF+x}" ] || _AGENT_SELF="$(gh api user --jq .login 2>/dev/null || true)"
  printf '%s' "$_AGENT_SELF"
}

# The trusted logins as the inside of a jq array literal: "a","b". Never empty, so IN() stays valid.
_trusted_logins() {
  local list
  list="$(printf '%s,%s' "$(_agent_self)" "$trusted_authors" \
    | jq -Rr 'split(",") | map(gsub("^\\s+|\\s+$"; "") | select(length>0) | @json) | join(",")')"
  printf '%s' "${list:-\"@@none@@\"}"
}

# jq predicate (source text) over one REST comment object, for `gh api ... --jq`.
trusted_jq() {
  printf '((.author_association | IN("OWNER","MEMBER","COLLABORATOR")) or (.user.login | IN(%s)))' "$(_trusted_logins)"
}

# Same predicate over one `gh ... --json author,authorAssociation` object.
_trusted_json_jq() {
  printf '((.authorAssociation | IN("OWNER","MEMBER","COLLABORATOR")) or (.author.login | IN(%s)))' "$(_trusted_logins)"
}

# ---- Leases ----------------------------------------------------------------------

has_label() { gh "$2" view "$1" --json labels --jq '.labels[].name' | grep -qx -- "$3"; }

lease_live() {
  local exp now
  exp=$(gh api "repos/{owner}/{repo}/issues/$1/comments" --paginate \
        --jq ".[] | select($(trusted_jq)) | .body | capture(\"<!-- agent:lease [^>]*expires=(?<e>[0-9TZ:-]+)\") | .e" \
        | tail -n1)
  now=$(date -u +%s)
  [ -n "$exp" ] && [ "$now" -lt "$(utc_epoch "$exp")" ]
}

claim() {
  local n=$1 kind=$2 label=$3 step=$4 ttl=$5 exp
  exp=$(utc_plus "$ttl")
  gh "$kind" edit "$n" --add-label "$label" >/dev/null
  gh "$kind" comment "$n" --body "$(node "$AGENT_HELPERS" lease-body "$step" "$RUN_ID" "$exp")" >/dev/null
}

renew() {
  local n=$1 kind=$2 step=$3 ttl=$4 exp
  exp=$(utc_plus "$ttl")
  gh "$kind" comment "$n" --body "$(node "$AGENT_HELPERS" lease-body "$step" "$RUN_ID" "$exp" renew)" >/dev/null
}

release() { gh "$2" edit "$1" --remove-label "$3" >/dev/null; }

# ---- Markers -----------------------------------------------------------------------

markers() {
  gh api "repos/{owner}/{repo}/issues/$1/comments" --paginate \
    --jq ".[] | select($(trusted_jq)) | .body | scan(\"<!-- agent:[^>]*-->\")"
}

review_rounds() { markers "$1" | grep -c 'agent:handoff kind=review' || true; }

shepherd_attempts() {
  markers "$1" | awk '/agent:handoff/{c=0} /agent:attempt step=shepherding/{c++} END{print c+0}'
}

fail_item() {
  local n=$1 kind=$2 step=$3 reason=$4
  gh "$kind" comment "$n" --body "$(node "$AGENT_HELPERS" failure-body "$step" "$RUN_ID" "$reason")" >/dev/null
}

# Failed runs of STEP since the last escalation. Failures written under a step's old name count too.
failures() {
  local legacy=""
  [ "$2" = Triaging ] && legacy=Grooming
  markers "$1" | awk -v s="$2" -v l="$legacy" '
    /agent:escalate/ { c=0 }
    index($0,"agent:failure step=" s " ") || (l != "" && index($0,"agent:failure step=" l " ")) { c++ }
    END { print c+0 }'
}

open_findings() {
  markers "$1" | awk '
    /agent:handoff kind=review/ { if (match($0,/open=[0-9]+/)) o=substr($0,RSTART+5,RLENGTH-5)+0; else o=1 }
    /agent:handoff kind=ready/  { o=0 }
    /agent:attempt step=shepherding/ { o=0 }
    END { print o+0 }'
}

ready_sha() {
  markers "$1" | grep 'agent:handoff kind=ready' | tail -n1 | sed -n 's/.*sha=\([0-9a-f]*\).*/\1/p'
}

# ---- Issue <-> PR links ---------------------------------------------------------------
# The `agent:implements` marker in a PR description counts only when a trusted account wrote the PR.
# The branch-name and Closes/Fixes/Resolves matches are the same signals GitHub itself uses.

prs_for_issue() {
  gh pr list --state all --limit 200 --json number,state,body,headRefName,author,authorAssociation \
  | jq -r --arg n "$1" "
      .[] | $(_trusted_json_jq) as \$ok
      | select( ((\$ok) and ((.body // \"\") | contains(\"<!-- agent:implements issue=\" + \$n + \" -->\")))
             or (.headRefName | test(\"^[a-z]+/\" + \$n + \"-\"))
             or ((.body // \"\") | test(\"(?i)(closes|fixes|resolves)\\\\s+#\" + \$n + \"\\\\b\")) )
      | \"\\(.number) \\(.state)\""
}

issue_for_pr() {
  gh pr view "$1" --json body,closingIssuesReferences,author,authorAssociation --jq "
    $(_trusted_json_jq) as \$ok
    | ([ (.body // \"\") | scan(\"agent:implements issue=([0-9]+)\") | .[0] | select(\$ok) ]
       + [ (.body // \"\") | scan(\"(?i)(?:closes|fixes|resolves)\\\\s+#([0-9]+)\") | .[0] ]
       + [ .closingIssuesReferences[].number | tostring ]) | unique | .[]"
}

# ---- Run log -------------------------------------------------------------------------

log_issue() {
  local title n cutoff
  cutoff=$(utc_plus "-14 days")
  n=$(gh issue list --label agent:log --state open --limit 5 --json number,createdAt \
        --jq --arg c "$cutoff" '[.[] | select(.createdAt >= $c)] | sort_by(.number) | .[0].number // empty')
  if [ -z "$n" ]; then
    title="Agent log $(date -u +%Y-%m-%d)"
    n=$(gh issue create --title "$title" --label agent:log \
          --body "Append-only run log: one comment per run. Covers roughly two weeks. Excluded from every workflow step." \
        | grep -o '[0-9]*$')
  fi
  echo "$n"
}

log_run() {
  local file=$1 body step diff_n
  gh issue comment "$(log_issue)" --body-file "$file" >/dev/null
  body=$(cat "$file")
  echo "$body" | grep -q '\*\*Problems:\*\*' || return 0
  echo "$body" | awk '/\*\*Problems:\*\*/{p=$0; sub(/.*\*\*Problems:\*\*[[:space:]]*/,"",p); if(length(p)==0) exit 1}' || return 0
  step=$(echo "$body" | sed -n 's/.*\*\*Step:\*\*[[:space:]]*\([^[:space:]]*\).*/\1/p' | head -1)
  if [ -z "$step" ]; then
    step=$(echo "$body" | awk '/^```ya?ml$/{f=1;next} /^```$/{f=0} f && /^step:/{sub(/^step:[[:space:]]*/,""); print; exit}')
  fi
  [ -n "$step" ] || return 0
  diff_n=$(difficulty_issue "$step")
  [ -n "$diff_n" ] || return 0
  gh issue comment "$diff_n" --body-file "$file" >/dev/null
}

difficulty_issue() {
  local step=$1 title n
  title="Agent difficulties: $step"
  n=$(gh issue list --label agent:difficulty --state open --search "\"$title\" in:title" \
        --json number,title --jq --arg t "$title" '.[] | select(.title==$t) | .number' | head -1)
  if [ -z "$n" ]; then
    n=$(gh issue create --title "$title" --label agent:difficulty \
          --body "Difficulties encountered by the $step step. One comment per run that reported **Problems**. Rotate on a ~2 week cadence like the run log." \
        | grep -o '[0-9]*$')
  fi
  echo "$n"
}

read_logs() {
  local cutoff n
  cutoff=$(utc_plus "-$1 days")
  for n in $(gh issue list --label agent:log --state all --limit 3 --json number --jq '.[].number'); do
    gh issue view "$n" --json comments \
      --jq ".comments[] | select(.createdAt > \"$cutoff\")
            | select((.body | contains(\"Outcome:** nothing eligible\") and (contains(\"**Problems:**\") | not)) | not)
            | \"---\n\" + .body"
  done
}
