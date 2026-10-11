#!/usr/bin/env bash
# Shared helpers for the GitHub agent workflow (see ../SKILL.md).
# Usage: source <this skill's directory>/scripts/lib.sh   (run from inside the target repository)
# Requires: gh (authenticated), jq, and Python 3 for portable date arithmetic.
#
# Config is layered: this skill's config.defaults.env first, then the repository's own
# overrides in .agents/docs/github-agent-workflow.env (written by /setup-github-agent-workflow).
# Set AGENT_REPO_CONFIG to read the overrides from somewhere else.

AGENT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck disable=SC1091
source "$AGENT_LIB_DIR/../config.defaults.env"
AGENT_REPO_CONFIG="${AGENT_REPO_CONFIG:-$AGENT_ROOT/.agents/docs/github-agent-workflow.env}"
if [ -f "$AGENT_REPO_CONFIG" ]; then
  # shellcheck disable=SC1090
  source "$AGENT_REPO_CONFIG"
fi

# Portable date helpers: GNU `date -d` is unavailable on macOS, so the workflow uses
# Python's datetime library for ISO parsing and relative durations.

utc_epoch() {
  python3 - "$1" <<'PY'
import sys
from datetime import datetime, timezone
s = sys.argv[1].strip()
if not s:
    raise SystemExit(1)
if s.endswith('Z'):
    s = s[:-1] + '+00:00'
try:
    dt = datetime.fromisoformat(s)
except ValueError as exc:
    raise SystemExit(str(exc))
if dt.tzinfo is None:
    dt = dt.replace(tzinfo=timezone.utc)
else:
    dt = dt.astimezone(timezone.utc)
print(int(dt.timestamp()))
PY
}

utc_plus() {
  python3 - "$1" <<'PY'
import re
import sys
from datetime import datetime, timedelta, timezone
expr = sys.argv[1].strip()
if not expr:
    raise SystemExit(1)
# Accept strings such as "+1 hour", "-7 days", or "1 hour".
sign = 1
if expr.startswith('+'):
    expr = expr[1:].lstrip()
elif expr.startswith('-'):
    sign = -1
    expr = expr[1:].lstrip()
match = re.fullmatch(r'(\d+)\s*(second|minute|hour|day|week|month|year)s?', expr, flags=re.IGNORECASE)
if not match:
    raise SystemExit(f"unsupported duration: {sys.argv[1]!r}")
value = int(match.group(1)) * sign
unit = match.group(2).lower()
base = datetime.now(timezone.utc)
if unit == 'second':
    delta = timedelta(seconds=value)
elif unit == 'minute':
    delta = timedelta(minutes=value)
elif unit == 'hour':
    delta = timedelta(hours=value)
elif unit == 'day':
    delta = timedelta(days=value)
elif unit == 'week':
    delta = timedelta(weeks=value)
else:
    # `timedelta` does not support months/years, so add them carefully using calendar-aware logic.
    year = base.year + (base.month - 1 + value) // 12
    month = (base.month - 1 + value) % 12 + 1
    day = min(base.day, 28)
    delta = datetime(year, month, day, base.hour, base.minute, base.second, base.microsecond, tzinfo=timezone.utc) - base
    if unit == 'year':
        # Keep the month/day relationship stable for year moves; the workflow only uses hours/days.
        year = base.year + value
        month = base.month
        day = min(base.day, 28)
        delta = datetime(year, month, day, base.hour, base.minute, base.second, base.microsecond, tzinfo=timezone.utc) - base
print((base + delta).strftime('%Y-%m-%dT%H:%M:%SZ'))
PY
}

RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
export RUN_ID

# ---- Leases -------------------------------------------------------------
# A lease is live iff the item carries its lease label AND the newest lease
# marker comment has not expired. Callers check the label; this checks expiry.

# has_label <number> <issue|pr> <label>  -> exit 0 if the item currently carries the label
has_label() { gh "$2" view "$1" --json labels --jq '.labels[].name' | grep -qx -- "$3"; }

# lease_live <number>  -> exit 0 if the newest lease marker is unexpired
lease_live() {
  local exp now
  exp=$(gh api "repos/{owner}/{repo}/issues/$1/comments" --paginate \
        --jq '.[] | .body | capture("<!-- agent:lease [^>]*expires=(?<e>[0-9TZ:-]+)") | .e' \
        | tail -n1)
  now=$(date -u +%s)
  [ -n "$exp" ] && [ "$now" -lt "$(utc_epoch "$exp")" ]
}

# claim <number> <issue|pr> <label> <step> <ttl>   e.g. claim 12 issue agent:triage Grooming "$LEASE_TTL_TRIAGE"
claim() {
  local n=$1 kind=$2 label=$3 step=$4 ttl=$5 exp
  exp=$(utc_plus "+$ttl")
  gh "$kind" edit "$n" --add-label "$label" >/dev/null
  gh "$kind" comment "$n" --body "Claimed by $step run $RUN_ID until $exp.
<!-- agent:lease step=$step run=$RUN_ID expires=$exp -->" >/dev/null
}

# renew <number> <issue|pr> <step> <ttl>   (post a newer marker; newest wins)
renew() {
  local n=$1 kind=$2 step=$3 ttl=$4 exp
  exp=$(utc_plus "+$ttl")
  gh "$kind" comment "$n" --body "Lease renewed by $step run $RUN_ID until $exp.
<!-- agent:lease step=$step run=$RUN_ID expires=$exp -->" >/dev/null
}

# release <number> <issue|pr> <label>   (call on success AND failure)
release() { gh "$2" edit "$1" --remove-label "$3" >/dev/null; }

# ---- Markers ------------------------------------------------------------
# markers <number> -> every agent marker found in the item's comments, in order
markers() {
  gh api "repos/{owner}/{repo}/issues/$1/comments" --paginate \
    --jq '.[] | .body | scan("<!-- agent:[^>]*-->")'
}

# review_rounds <pr>        -> number of Reviewing runs that did not merge
review_rounds() { markers "$1" | grep -c 'agent:handoff kind=review' || true; }

# shepherd_attempts <pr>    -> Shepherding fix attempts since the last handoff of any kind
shepherd_attempts() {
  markers "$1" | awk '/agent:handoff/{c=0} /agent:attempt step=shepherding/{c++} END{print c+0}'
}

# fail_item <number> <issue|pr> <step> <reason>  -> tell a human, and let failures() count it
fail_item() {
  local n=$1 kind=$2 step=$3 reason=$4
  gh "$kind" comment "$n" --body "$step run $RUN_ID failed: $reason
<!-- agent:failure step=$step run=$RUN_ID -->" >/dev/null
}

# failures <number> <step>  -> failed runs of <step> on this item since the last escalation
failures() {
  markers "$1" | awk -v s="$2" '/agent:escalate/{c=0} index($0,"agent:failure step=" s " "){c++} END{print c+0}'
}

# open_findings <pr>  -> number of review findings still open (0 if none).
# The newest event decides: a review handoff sets it to its open=N (1 if absent);
# a ready handoff or a Shepherding attempt after it resets it to 0.
open_findings() {
  markers "$1" | awk '
    /agent:handoff kind=review/ { if (match($0,/open=[0-9]+/)) o=substr($0,RSTART+5,RLENGTH-5)+0; else o=1 }
    /agent:handoff kind=ready/  { o=0 }
    /agent:attempt step=shepherding/ { o=0 }
    END { print o+0 }'
}

# ready_sha <pr>  -> head SHA recorded by the newest `kind=ready` handoff (empty if none)
ready_sha() {
  markers "$1" | grep 'agent:handoff kind=ready' | tail -n1 | sed -n 's/.*sha=\([0-9a-f]*\).*/\1/p'
}

# ---- Issue <-> PR links -------------------------------------------------
# A PR "belongs to" issue N if ANY of these is true (several signals, because
# GitHub's own "closing reference" only works for PRs aimed at the default branch):
#   1. its body has the hidden marker  <!-- agent:implements issue=N -->
#   2. its branch is  <type>/N-<topic>
#   3. its body says  Closes|Fixes|Resolves #N

# prs_for_issue <issue>  -> one line per PR: "<number> <OPEN|MERGED|CLOSED>" (newest 200 PRs, all states)
prs_for_issue() {
  gh pr list --state all --limit 200 --json number,state,body,headRefName \
  | jq -r --arg n "$1" '.[]
      | select( ((.body // "") | contains("<!-- agent:implements issue=" + $n + " -->"))
             or (.headRefName | test("^[a-z]+/" + $n + "-"))
             or ((.body // "") | test("(?i)(closes|fixes|resolves)\\s+#" + $n + "\\b")) )
      | "\(.number) \(.state)"'
}

# issue_for_pr <pr>  -> issue numbers this PR implements (marker, Closes/Fixes/Resolves text, or GitHub closing reference), one per line
issue_for_pr() {
  gh pr view "$1" --json body,closingIssuesReferences --jq '
    ([ (.body // "") | scan("agent:implements issue=([0-9]+)") | .[0] ]
     + [ (.body // "") | scan("(?i)(?:closes|fixes|resolves)\\s+#([0-9]+)") | .[0] ]
     + [ .closingIssuesReferences[].number | tostring ]) | unique | .[]'
}

# ---- Run log ------------------------------------------------------------
# log_issue -> prints the number of this month's log issue (creates it if missing)
log_issue() {
  local title n
  title="Agent log $(date -u +%Y-%m)"
  n=$(gh issue list --label agent:log --state open --search "\"$title\" in:title" \
        --json number --jq 'sort_by(.number) | .[0].number // empty')
  if [ -z "$n" ]; then
    n=$(gh issue create --title "$title" --label agent:log \
          --body "Append-only run log: one comment per run. Excluded from every workflow step. Do not close during the month." \
        | grep -o '[0-9]*$')
  fi
  echo "$n"
}

# log_run <body-file>  -> append the file as one comment on the log issue
log_run() { gh issue comment "$(log_issue)" --body-file "$1" >/dev/null; }

# read_logs <days>  -> bodies of log comments newer than <days> days.
# Idle entries ("Outcome: nothing eligible" and no Problems line) are skipped: they only prove a run happened.
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
