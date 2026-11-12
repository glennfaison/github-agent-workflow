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
# Helpers: has_label lease_live claim renew release clear_stale_lease   leases (one comment per step)
#          lane_holder ready_at                                  the merge lane
#          changed_files protected_files codeowners_for          paths and owners
#          markers review_rounds shepherd_attempts failures    reading markers
#          open_findings ready_sha fail_item                   handoffs and failures
#          prs_for_issue issue_for_pr                          issue <-> PR links
#          parent_of children_of depth_of link_sub_issue       sub-issue links (splitting an issue)
#          client_guidance_files item_labels                   the repository's own agent rules
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
: "${ready_lane_ttl:=2 hours}"
: "${human_merge_paths:=}"
: "${triage_batch:=${groom_batch:-5}}"          # groom_batch is the deprecated name
: "${implement_batch:=1}"
: "${shepherd_batch:=3}"
: "${review_batch:=3}"
: "${max_shepherd_attempts:=3}"
: "${max_review_rounds:=3}"
: "${max_item_failures:=3}"
: "${max_depth:=1}"
: "${runner:=unknown}"
: "${unattended:=true}"
: "${trusted_authors:=}"
: "${write_log:=true}"
: "${lease_held:=false}"

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
ready_lane_ttl:READY_LANE_TTL
human_merge_paths:HUMAN_MERGE_PATHS
triage_batch:TRIAGE_BATCH
implement_batch:IMPLEMENT_BATCH
shepherd_batch:SHEPHERD_BATCH
review_batch:REVIEW_BATCH
max_shepherd_attempts:MAX_SHEPHERD_ATTEMPTS
max_review_rounds:MAX_REVIEW_ROUNDS
max_item_failures:MAX_ITEM_FAILURES
max_depth:MAX_DEPTH
runner:RUNNER
unattended:UNATTENDED
trusted_authors:TRUSTED_AUTHORS
write_log:WRITE_LOG
lease_held:LEASE_HELD
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

# ---- Leases ----------------------------------------------------------------------

has_label() { gh "$2" view "$1" --json labels --jq '.labels[].name' | grep -qx -- "$3"; }

# The newest trusted lease is the one written last (updated_at, else created_at; see leaseState in
# helpers.mjs), because claim and renew edit a step's lease comment in place. `sort -s` keeps thread
# order for equal times. The expiry is the one in the marker, never the comment's own timestamp.
lease_live() {
  local exp now
  exp=$(gh api "repos/{owner}/{repo}/issues/$1/comments" --paginate \
        --jq ".[] | select($(trusted_jq)) | (.updated_at // .created_at // \"0\") as \$t | .body | capture(\"<!-- agent:lease [^>]*expires=(?<e>[0-9TZ:-]+)\") | \"\\(\$t) \\(.e)\"" \
        | sort -s -k1,1 | tail -n1 | cut -d' ' -f2)
  now=$(date -u +%s)
  [ -n "$exp" ] && [ "$now" -lt "$(utc_epoch "$exp")" ]
}

# Write the lease comment for STEP on item N: edit this account's own lease comment for the step if
# the item has one, otherwise post one. An item that goes through several claims and renewals keeps
# one lease comment per step instead of one per claim. If the edit fails, post: lease_live reads the
# newest lease either way, so the fallback is only noisier.
_write_lease() {
  local n=$1 kind=$2 step=$3 exp=$4 how=$5 body id
  body="$(node "$AGENT_HELPERS" lease-body "$step" "$RUN_ID" "$exp" "$how")"
  id=$(gh api "repos/{owner}/{repo}/issues/$n/comments" --paginate \
         --jq '.[] | {id, body, login: .user.login} | @json' 2>/dev/null \
       | node "$AGENT_HELPERS" own-lease "$step" "$(_agent_self)") || id=
  if [ -n "$id" ] && gh api -X PATCH "repos/{owner}/{repo}/issues/comments/$id" -f body="$body" >/dev/null 2>&1; then
    return 0
  fi
  gh "$kind" comment "$n" --body "$body" >/dev/null
}

# claim and release do nothing when $lease_held is true: the caller holds the lease (a nested call).
claim() {
  [ "$lease_held" = true ] && return 0
  local n=$1 kind=$2 label=$3 step=$4 ttl=$5 exp
  exp=$(utc_plus "$ttl")
  gh "$kind" edit "$n" --add-label "$label" >/dev/null
  _write_lease "$n" "$kind" "$step" "$exp" claim
}

renew() {
  local n=$1 kind=$2 step=$3 ttl=$4 exp
  exp=$(utc_plus "$ttl")
  _write_lease "$n" "$kind" "$step" "$exp" renew
}

release() {
  [ "$lease_held" = true ] && return 0
  gh "$2" edit "$1" --remove-label "$3" >/dev/null
}

# Remove lease labels whose marker has expired or is missing, so a dead runner or an expired TTL
# does not leave agent:triage / agent:in-progress on the board. This writes, so it is never part of
# an eligibility check: reconcile-github-issues calls it. An item with only a stale label is already
# unleased (lease_live decides), and the next claim replaces the label.
clear_stale_lease() {
  local n=$1 kind=$2
  lease_live "$n" && return 0
  for label in agent:triage agent:in-progress; do
    if has_label "$n" "$kind" "$label"; then
      release "$n" "$kind" "$label"
    fi
  done
}

# ---- Markers -----------------------------------------------------------------------

markers() {
  gh api "repos/{owner}/{repo}/issues/$1/comments" --paginate \
    --jq ".[] | select($(trusted_jq)) | .body | scan(\"<!-- agent:[^>]*-->\")"
}

# Review handoffs since the last hand-off to a human (agent:human-merge).
review_rounds() { markers "$1" | awk '/agent:human-merge/{c=0} /agent:handoff kind=review/{c++} END{print c+0}'; }

shepherd_attempts() {
  markers "$1" | awk '/agent:handoff/{c=0} /agent:human-merge/{c=0} /agent:attempt step=shepherding/{c++} END{print c+0}'
}

# When the newest trusted `kind=ready` handoff on PR $1 was posted, or nothing if it has none.
ready_at() {
  gh api "repos/{owner}/{repo}/issues/$1/comments" --paginate \
    --jq ".[] | select($(trusted_jq)) | select(.body | contains(\"agent:handoff kind=ready\")) | .created_at" \
    | tail -n1
}

# The merge lane. Prints the number of another PR that holds it and returns 0, or prints nothing and
# returns 1 when it is free. A PR holds it while it is open, labelled agent:ready-for-review, not a
# draft, not agent:stuck or agent:human-merge, and its ready handoff is younger than $ready_lane_ttl (see laneHolder in
# helpers.mjs). Shepherding calls this before it updates a branch or posts a ready handoff.
lane_holder() {
  local self=$1 n at list="" holder
  for n in $(gh pr list --state open --label agent:ready-for-review --limit 100 --json number,isDraft,labels \
      | jq -r '.[] | select((.isDraft | not) and (([.labels[].name] | index("agent:stuck")) | not) and (([.labels[].name] | index("agent:human-merge")) | not)) | .number'); do
    [ "$n" = "$self" ] && continue
    at=$(ready_at "$n")
    list="$list{\"number\":$n,\"readyAt\":\"$at\"},"
  done
  holder=$(printf '[%s]' "${list%,}" | node "$AGENT_HELPERS" lane-holder "$self" "$ready_lane_ttl")
  [ -n "$holder" ] && printf '%s\n' "$holder"
}

# The files PR $1 changes, one per line, with the old name of a renamed file. Fails if it cannot read them.
changed_files() {
  gh api "repos/{owner}/{repo}/pulls/$1/files" --paginate --jq '.[] | .filename, (.previous_filename // empty)'
}

# The changed files that match $human_merge_paths (see protectedFiles in helpers.mjs), one per line.
# Prints nothing when none match or when $human_merge_paths is empty. Fails closed: if the list of
# changed files cannot be read, or is empty (a PR always changes a file), or a pattern is unsupported,
# the status is not 0 and the caller must not merge.
protected_files() {
  [ -n "$human_merge_paths" ] || return 0
  local files; files=$(changed_files "$1") || return 2
  [ -n "$files" ] || return 2
  printf '%s\n' "$files" | jq -R . | jq -s . | node "$AGENT_HELPERS" protected-files "$human_merge_paths"
}

# The CODEOWNERS owners of the files PR $1 changes, one per line, read from the PR's base branch (never
# its head, which the PR could edit). Prints nothing when there is no CODEOWNERS file or no owner.
codeowners_for() {
  local n=$1 base p text="" files
  base=$(gh pr view "$n" --json baseRefName --jq .baseRefName) || return 1
  for p in .github/CODEOWNERS CODEOWNERS docs/CODEOWNERS; do
    if text=$(gh api -H "Accept: application/vnd.github.raw" "repos/{owner}/{repo}/contents/$p?ref=$base" 2>/dev/null); then break; fi
    text=""
  done
  [ -n "$text" ] || return 0
  files=$(changed_files "$n") || return 1
  printf '%s\n' "$files" | jq -R . | jq -s --arg t "$text" '{text:$t, files:.}' | node "$AGENT_HELPERS" codeowners
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
    /agent:escalate/ || /agent:human-merge/ { c=0 }
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
# Branch pattern (must match helpers.mjs isCompliantBranchName / prs_for_issue heuristic):
#   ^[a-z]+/<issueNumber>-<kebab-slug>$
# e.g. feature/24-refuse-noncompliant-branch-names or bugfix/12-login-timeout
# Implementing must not push a branch that fails this pattern.

prs_for_issue() {
  local prs page
  # The REST pull request has `author_association` and `user.login`, which `trusted_jq` reads. `gh pr list --json` has no
  # author association, and asking it for one is an error. The 200 newest PRs, as before.
  prs=$(for page in 1 2; do gh api "repos/{owner}/{repo}/pulls?state=all&per_page=100&page=$page" || exit 1; done) || return 1
  printf '%s\n' "$prs" | jq -r --arg n "$1" "
      .[] | $(trusted_jq) as \$ok
      | select( ((\$ok) and ((.body // \"\") | contains(\"<!-- agent:implements issue=\" + \$n + \" -->\")))
             or ((.head.ref // \"\") | test(\"^[a-z]+/\" + \$n + \"-\"))
             or ((.body // \"\") | test(\"(?i)(closes|fixes|resolves)\\\\s+#\" + \$n + \"\\\\b\"))
             or ((.title // \"\") | test(\"(?i)(closes|fixes|resolves|implements)\\\\s+(?:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)?#\" + \$n + \"\\\\b\")) )
      | \"\\(.number) \\(if .merged_at then \"MERGED\" elif .state == \"open\" then \"OPEN\" else \"CLOSED\" end)\""
}

issue_for_pr() {
  local n=$1 pr refs
  pr=$(gh api "repos/{owner}/{repo}/pulls/$n") || return 1
  # GitHub's own links (closing keywords, the Development sidebar). `gh` has this field from 2.72. With an older `gh` it is
  # skipped, and the body is still read for `Closes #N` and for a trusted marker.
  if ! refs=$(gh pr view "$n" --json closingIssuesReferences --jq '.closingIssuesReferences[].number' 2>&1); then
    case $refs in *"Unknown JSON field"*) refs="" ;; *) printf '%s\n' "$refs" >&2; return 1 ;; esac
  fi
  { printf '%s\n' "$pr" | jq -r "
      $(trusted_jq) as \$ok
      | ([ (.body // \"\") | scan(\"agent:implements issue=([0-9]+)\") | .[0] | select(\$ok) ]
         + [ (.body // \"\") | scan(\"(?i)(?:closes|fixes|resolves)\\\\s+#([0-9]+)\") | .[0] ]) | .[]"
    printf '%s\n' "$refs"
  } | sed '/^$/d' | sort -un
}

# ---- Sub-issue links ---------------------------------------------------------------------
# A split (../references/split.md) uses GitHub's own sub-issue links and nothing else: text in an issue body
# is not a link, because anyone can write it. These read and write the links. A status other than success
# means the answer could not be read, which is not the same as "none": parent_of prints nothing and succeeds
# for an issue with no parent (a 404), and fails for any other error. So depth_of never mistakes an
# unreadable parent for the top of the tree. Whether an issue may split is decided by helpers.mjs (canSplit).

# The issue that N is a sub-issue of, or nothing when it has none.
parent_of() {
  local out
  if out="$(gh api "repos/{owner}/{repo}/issues/$1/parent" --jq .number 2>&1)"; then
    printf '%s\n' "$out"
  elif printf '%s' "$out" | grep -q 'HTTP 404'; then
    return 0
  else
    return 1
  fi
}

# The sub-issues of N, one number per line.
children_of() { gh api "repos/{owner}/{repo}/issues/$1/sub_issues" --paginate --jq '.[].number'; }

# How many ancestors N has: 0 with no parent. Fails when a parent cannot be read, or on a cycle.
depth_of() {
  local start=$1 n=$1 p map="" i=0
  while :; do
    p="$(parent_of "$n")" || return 1
    if [ -z "$p" ]; then map+="$n -"$'\n'; break; fi
    map+="$n $p"$'\n'
    n=$p; i=$((i+1))
    [ "$i" -le 20 ] || return 1
  done
  printf '%s' "$map" | node "$AGENT_HELPERS" depth "$start"
}

# Make X a sub-issue of N. Succeeds when it already is one. Use it only for an issue this run filed.
link_sub_issue() {
  local id
  [ "$(parent_of "$2")" = "$1" ] && return 0
  id="$(gh api "repos/{owner}/{repo}/issues/$2" --jq .id)" || return 1
  gh api -X POST "repos/{owner}/{repo}/issues/$1/sub_issues" -F "sub_issue_id=$id" >/dev/null
}

# ---- Client guidance -----------------------------------------------------------------
# The repository's own agent-facing rules (see ../references/client-guidance.md). Always the DEFAULT
# branch: a PR can edit AGENTS.md, so its copy is data, not guidance. The path filter lives in
# helpers.mjs (isGuidancePath) so a runner with no shell applies the same one.

# One path per line: every guidance file on the default branch, plus the `repo_guidance` files.
client_guidance_files() {
  gh api "repos/{owner}/{repo}/git/trees/HEAD?recursive=1" --jq '.tree[] | select(.type == "blob") | .path' \
    | node "$AGENT_HELPERS" guidance-files "$repo_guidance"
}

# `<label>: <description>` for each label on an issue or PR. A label's description is how a repository
# says what the label means ("stays open indefinitely"), so read it before closing or merging.
item_labels() {
  local all name
  all="$(gh label list --limit 300 --json name,description 2>/dev/null || true)"
  [ -n "$all" ] || all='[]'
  gh "$2" view "$1" --json labels --jq '.labels[].name' | while IFS= read -r name; do
    [ -n "$name" ] || continue
    printf '%s: %s\n' "$name" "$(printf '%s' "$all" | jq -r --arg n "$name" '.[] | select(.name == $n) | .description // ""')"
  done
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
