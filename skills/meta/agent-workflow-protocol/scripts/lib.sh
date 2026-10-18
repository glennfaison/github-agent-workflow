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
#          log_issue log_run log_status read_logs              run log
# Every marker is read through trusted_jq / _trusted_logins: a marker written by an account that is
# not trusted (see "Trust" in ../SKILL.md) is ignored.

AGENT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_HELPERS="$AGENT_LIB_DIR/helpers.mjs"
AGENT_ROOT="$(git rev-parse --show-toplevel)"

# ---- Defaults ---------------------------------------------------------------
: "${app_url:=}"
: "${explore_batch:=${issues_per_run:-5}}"      # issues_per_run is the deprecated name
: "${log_window_days:=${log_lookback_days:-14}}"  # log_lookback_days is the deprecated name
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
log_window_days:LOG_WINDOW_DAYS
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
  gh pr list --state all --limit 200 --json number,state,title,body,headRefName,author,authorAssociation \
  | jq -r --arg n "$1" "
      .[] | $(_trusted_json_jq) as \$ok
      | select( ((\$ok) and ((.body // \"\") | contains(\"<!-- agent:implements issue=\" + \$n + \" -->\")))
             or (.headRefName | test(\"^[a-z]+/\" + \$n + \"-\"))
             or ((.body // \"\") | test(\"(?i)(closes|fixes|resolves)\\\\s+#\" + \$n + \"\\\\b\"))
             or ((.title // \"\") | test(\"(?i)(closes|fixes|resolves|implements)\\\\s+(?:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)?#\" + \$n + \"\\\\b\")) )
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
# One open agent:log issue at a time, appended to until its window (log_window_days) ends. Which
# issue is current, the issue body and the entry stamping all come from helpers.mjs, so this file
# and a runner with no shell cannot disagree. Details: ../references/log.md.
# gh's --jq takes exactly one expression and has no --arg. Pass it nothing else: an earlier version
# did, the lookup failed silently every time, and every run opened a new log issue.

_log_issues() { gh issue list --label agent:log --state open --limit 30 --json number,createdAt,body; }

# The number of the log issue to append to. Creates one only when no open window exists.
log_issue() {
  local win n mine now
  win=$(node "$AGENT_HELPERS" log-window "$log_window_days") || return 1
  n=$(_log_issues | node "$AGENT_HELPERS" log-current "$win") || return 1
  if [ -z "$n" ]; then
    now=$(utc_plus "0s")
    gh label create "agent:log" --color C5DEF5 --description "Agent run log" >/dev/null 2>&1 || true
    mine=$(gh issue create --title "$(node "$AGENT_HELPERS" log-title)" --label agent:log \
             --body "$(node "$AGENT_HELPERS" log-body "$now" "$(utc_plus "$win days")")" \
           | grep -o '[0-9]*$' | tail -n1) || true
    [ -n "$mine" ] || { echo "log_issue: could not create the log issue" >&2; return 1; }
    n=$mine
    # Two runs can start in the same second and both create one. The lowest number wins and the
    # other run closes its own, so every later run appends to the same issue.
    local lowest
    lowest=$(_log_issues | node "$AGENT_HELPERS" log-current "$win") || lowest=
    if [ -n "$lowest" ] && [ "$lowest" -lt "$mine" ]; then
      gh issue close "$mine" --reason "not planned" \
        --comment "Duplicate of #$lowest: there is one run log per window." >/dev/null 2>&1 || true
      n=$lowest
    fi
  fi
  echo "$n"
}

_log_has_entry() { # N FILE -> yes|no: this run and step already have an entry on log issue N
  gh api "repos/{owner}/{repo}/issues/$1/comments" --paginate --jq '.[].body | @json' \
    | node "$AGENT_HELPERS" log-has-entry "$2"
}

# Post FILE as this run's entry on the current log issue, then bring the issue body's "Last entry"
# up to date. Safe to run twice: one entry per run and step. Difficulties are part of the entry
# (Problems, Things to improve); there is no separate difficulty issue.
log_run() {
  local file=$1 n entry
  [ -f "$file" ] || { echo "log_run: no such file: $file" >&2; return 1; }
  n=$(log_issue) || return 1
  [ -n "$n" ] || { echo "log_run: no log issue" >&2; return 1; }
  if [ "$(_log_has_entry "$n" "$file")" = yes ]; then return 0; fi
  entry=$(mktemp) || return 1
  if ! { node "$AGENT_HELPERS" log-stamp < "$file" > "$entry" && gh issue comment "$n" --body-file "$entry" >/dev/null; }; then
    rm -f "$entry"; return 1
  fi
  if gh issue view "$n" --json body,createdAt | node "$AGENT_HELPERS" log-touch "$entry" "$log_window_days" > "$entry.body"; then
    gh issue edit "$n" --body-file "$entry.body" >/dev/null || echo "log_run: posted, but could not update issue #$n" >&2
  fi
  rm -f "$entry" "$entry.body"
}

# When the current log issue last got an entry, and when it rotates. Creates nothing.
log_status() {
  local n=${1:-}
  [ -n "$n" ] || n=$(_log_issues | node "$AGENT_HELPERS" log-current "$(node "$AGENT_HELPERS" log-window "$log_window_days")")
  [ -n "$n" ] || { echo "no open log issue"; return 1; }
  echo "issue=$n"
  gh issue view "$n" --json body,createdAt,updatedAt | node "$AGENT_HELPERS" log-meta
}

# Every non-idle entry of the last DAYS days, across the most recent log issues.
read_logs() {
  local cutoff n
  cutoff=$(utc_plus "-$1 days")
  for n in $(gh issue list --label agent:log --state all --limit 5 --json number --jq '.[].number'); do
    gh issue view "$n" --json comments | node "$AGENT_HELPERS" log-read "$cutoff"
  done
}
