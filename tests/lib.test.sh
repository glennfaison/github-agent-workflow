#!/usr/bin/env bash
# Tests for the shell helpers in agent-workflow-protocol/scripts/lib.sh, against a stub `gh`.
#   bash tests/lib.test.sh
# Needs bash, jq, git and Node.js. No network and no real `gh`.
set -u

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="$PKG/skills/meta/agent-workflow-protocol/scripts/lib.sh"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
export STATE="$WORK/state"; mkdir -p "$STATE" "$WORK/bin" "$WORK/repo"
echo '[]' > "$STATE/prs.json"

# ---- Stub gh: file-backed, covers only the calls lib.sh makes ------------------------------
cat > "$WORK/bin/gh" <<'STUB'
#!/usr/bin/env bash
cmd=$1; shift
if [ "$cmd" = pr ] && [ "${1:-}" = list ]; then cat "$STATE/prs.json"; exit 0; fi
jqf() { local f=""; while [ $# -gt 0 ]; do [ "$1" = --jq ] && f=$2; shift; done; jq -r "$f"; }
if [ "$cmd" = issue ] && [ "${1:-}" = list ]; then echo '[{"number":9}]' | jqf "$@"; exit 0; fi
case "$cmd" in
  api)   # gh api user --jq F   |   gh api repos/{owner}/{repo}/issues/N/comments --paginate --jq F
         if [ "$1" = user ]; then echo '{"login":"agent-bot"}' | jqf "$@"; exit 0; fi
         n=$(echo "$1" | sed -n 's#.*/issues/\([0-9]*\)/comments#\1#p')
         { cat "$STATE/comments_$n.json" 2>/dev/null || echo '[]'; } | jqf "$@" ;;
  issue|pr)
    sub=$1; shift; n=$1; shift
    lf="$STATE/labels_${cmd}_$n"; touch "$lf"
    case "$sub" in
      view) if [[ " $* " == *" comments "* ]]; then
              jq '{comments: .}' "$STATE/comments_$n.json" | jqf "$@"
            elif [ "$cmd" = pr ] && [[ " $* " == *closingIssuesReferences* ]]; then
              jq --argjson n "$n" '.[]|select(.number==$n)|{body,authorAssociation,author,closingIssuesReferences:(.closing//[])|map({number:.})}' "$STATE/prs.json" | jqf "$@"
            else jq -Rn '{labels:[inputs|select(length>0)|{name:.}]}' "$lf" | jqf "$@"; fi ;;
      edit) while [ $# -gt 0 ]; do case $1 in
              --add-label)    grep -qx -- "$2" "$lf" || echo "$2" >> "$lf"; shift ;;
              --remove-label) grep -vx -- "$2" "$lf" > "$lf.t"; mv "$lf.t" "$lf"; shift ;; esac; shift; done ;;
      comment) body=""; while [ $# -gt 0 ]; do [ "$1" = --body ] && body=$2; shift; done
               cf="$STATE/comments_$n.json"; [ -f "$cf" ] || echo '[]' > "$cf"
               jq --arg b "$body" '. + [{body:$b, author_association:"NONE", user:{login:"agent-bot"}}]' "$cf" > "$cf.t"; mv "$cf.t" "$cf" ;;
    esac ;;
esac
STUB
chmod +x "$WORK/bin/gh"; export PATH="$WORK/bin:$PATH"

# lib.sh needs to run inside a git repository, but not this one
git init -q "$WORK/repo" && cd "$WORK/repo" || exit 1

pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ok   $1"; else fail=$((fail+1)); echo "  FAIL $1  (expected '$2', got '$3')"; fi
}
c() { local cf="$STATE/comments_$1.json"; [ -f "$cf" ] || echo '[]' > "$cf"   # c N body [association] [login]
      jq --arg b "$2" --arg a "${3:-OWNER}" --arg l "${4:-maintainer}" \
         '. + [{body:$b, author_association:$a, user:{login:$l}}]' "$cf" > "$cf.t"; mv "$cf.t" "$cf"; }

echo "Defaults"
( set -e; source "$LIB" ); check "sourcing with set -e survives, and no config file is needed" 0 $?
check "pr_base_branch default"  "main"          "$(bash -c 'source "$1"; echo "$pr_base_branch"' _ "$LIB")"
check "triage_batch default"     "5"             "$(bash -c 'source "$1"; echo "$triage_batch"' _ "$LIB")"
check "merge_method default"    "squash"        "$(bash -c 'source "$1"; echo "$merge_method"' _ "$LIB")"
check "build_cmd default empty" ""              "$(bash -c 'source "$1"; echo "$build_cmd"' _ "$LIB")"
check "lower and upper match"   "1 hour:1 hour" "$(bash -c 'source "$1"; echo "$lease_ttl_triage:$LEASE_TTL_TRIAGE"' _ "$LIB")"

echo "Overriding a default"
printf 'pr_base_branch=develop\nbuild_cmd="npm run build"\nlease_ttl_pr="2 hours"\n' > "$WORK/overrides.env"
check "override file wins"      "develop"       "$(AGENT_OVERRIDES="$WORK/overrides.env" bash -c 'source "$1"; echo "$pr_base_branch"' _ "$LIB")"
check "override file adds"      "npm run build" "$(AGENT_OVERRIDES="$WORK/overrides.env" bash -c 'source "$1"; echo "$build_cmd"' _ "$LIB")"
check "override file takes spaces" "2 hours"     "$(AGENT_OVERRIDES="$WORK/overrides.env" bash -c 'source "$1"; echo "$lease_ttl_pr"' _ "$LIB")"
check "unset keys keep default" "squash"        "$(AGENT_OVERRIDES="$WORK/overrides.env" bash -c 'source "$1"; echo "$merge_method"' _ "$LIB")"
check "export wins"             "release/x"     "$(AGENT_OVERRIDES="$WORK/overrides.env" bash -c 'export merge_method=release/x; source "$1"; echo "$merge_method"' _ "$LIB")"
check "missing file is fine"    "main"          "$(AGENT_OVERRIDES="$WORK/nope.env" bash -c 'source "$1"; echo "$pr_base_branch"' _ "$LIB")"
rm -f "$WORK/overrides.env"

# shellcheck disable=SC1090
source "$LIB"

echo "Leases"
claim 1 issue agent:triage Triaging "1 hour"
has_label 1 issue agent:triage; check "claim adds label" 0 $?
lease_live 1;                    check "fresh lease is live" 0 $?
release 1 issue agent:triage
has_label 1 issue agent:triage;  check "release removes label" 1 $?
c 2 "<!-- agent:lease step=Triaging run=x expires=2020-01-01T00:00:00Z -->"
lease_live 2;                    check "expired lease is not live" 1 $?
lease_live 3;                    check "no marker = not live" 1 $?
c 2 "<!-- agent:lease step=Triaging run=y expires=2099-01-01T00:00:00Z -->"
lease_live 2;                    check "newest marker wins (renewed)" 0 $?
renew 4 issue Triaging "1 hour"
lease_live 4;                    check "renew posts a live marker" 0 $?

echo "PR counters and handoffs"
c 10 "ready <!-- agent:handoff kind=ready sha=abc123 -->"
c 10 "findings <!-- agent:handoff kind=review sha=abc123 open=2 -->"
check "review_rounds"          1 "$(review_rounds 10)"
check "open_findings after review" 2 "$(open_findings 10)"
check "ready_sha"              abc123 "$(ready_sha 10)"
c 10 "tried <!-- agent:attempt step=shepherding sha=def456 -->"
check "attempt resets open_findings" 0 "$(open_findings 10)"
check "shepherd_attempts=1"    1 "$(shepherd_attempts 10)"
c 10 "tried <!-- agent:attempt step=shepherding sha=def789 -->"
check "shepherd_attempts=2"    2 "$(shepherd_attempts 10)"
c 10 "ready <!-- agent:handoff kind=ready sha=def789 -->"
check "handoff resets attempts" 0 "$(shepherd_attempts 10)"
check "ready_sha is newest"    def789 "$(ready_sha 10)"
c 11 "x <!-- agent:handoff kind=review sha=aaa -->"
check "review handoff w/o open= counts as 1" 1 "$(open_findings 11)"

echo "Failure cap"
fail_item 20 issue Triaging "could not read ADR link"
fail_item 20 issue Triaging "again"
fail_item 20 issue Implementing "other step"
check "failures counts per step"        2 "$(failures 20 Triaging)"
check "other step is counted apart"     1 "$(failures 20 Implementing)"
check "no failures = 0"                 0 "$(failures 21 Triaging)"
c 20 "stuck <!-- agent:escalate step=Triaging -->"
check "escalation resets the count"     0 "$(failures 20 Triaging)"
fail_item 20 issue Triaging "after unsticking"
check "counting restarts after it"      1 "$(failures 20 Triaging)"
c 22 "merged <!-- agent:handoff kind=merged sha=abc -->"
check "merged handoff is not a review round" 0 "$(review_rounds 22)"
check "merged handoff leaves no open findings" 0 "$(open_findings 22)"

echo "Run log"
cat > "$STATE/comments_9.json" <<'J'
[{"body":"**Step:** Triaging\n**Outcome:** nothing eligible","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Shepherding\n**Outcome:** nothing eligible\n**Problems:** failed: #4 x","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Reviewing\n**Outcome:** 1 merged","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Exploring\n**Outcome:** 2 filed (too old)","createdAt":"2000-01-01T00:00:00Z"}]
J
logs=$(read_logs 14)
check "idle entry is skipped"           0 "$(grep -c 'Step:\*\* Triaging' <<<"$logs")"
check "idle entry with Problems is kept" 1 "$(grep -c 'Step:\*\* Shepherding' <<<"$logs")"
check "working entry is kept"           1 "$(grep -c 'Step:\*\* Reviewing' <<<"$logs")"
check "entry older than the window is dropped" 0 "$(grep -c 'Exploring' <<<"$logs")"

echo "Issue <-> PR links"
cat > "$STATE/prs.json" <<'J'
[{"number":50,"state":"OPEN","body":"x\n<!-- agent:implements issue=7 -->","headRefName":"feature/7-foo","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":51,"state":"MERGED","body":"Closes #8.","headRefName":"bugfix/zzz","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":52,"state":"CLOSED","body":"nothing","headRefName":"feature/9-bar","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":53,"state":"OPEN","body":"Closes #70.","headRefName":"feature/x","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}}]
J
check "link by marker+branch"  "50 OPEN"   "$(prs_for_issue 7)"
check "link by Closes text"    "51 MERGED" "$(prs_for_issue 8)"
check "link by branch only"    "52 CLOSED" "$(prs_for_issue 9)"
check "#7 must not match #70"  "53 OPEN"   "$(prs_for_issue 70)"
check "issue_for_pr (marker)"  7 "$(issue_for_pr 50)"
check "issue_for_pr (Closes)"  8 "$(issue_for_pr 51)"

echo "Trust"
cat > "$STATE/prs.json" <<'J'
[{"number":60,"state":"OPEN","body":"<!-- agent:implements issue=11 -->","headRefName":"x","closing":[],"authorAssociation":"NONE","author":{"login":"mallory"}},
 {"number":61,"state":"OPEN","body":"<!-- agent:implements issue=12 -->","headRefName":"x","closing":[],"authorAssociation":"NONE","author":{"login":"agent-bot"}}]
J
check "marker in a stranger's PR is not a link"    ""        "$(prs_for_issue 11)"
check "issue_for_pr ignores the stranger's marker" ""        "$(issue_for_pr 60)"
check "marker in the agent's own PR is a link"     "61 OPEN" "$(prs_for_issue 12)"
check "issue_for_pr trusts the agent's own PR"     12        "$(issue_for_pr 61)"
check "trusted_authors default is empty" "" "$(bash -c 'source "$1"; echo "$trusted_authors"' _ "$LIB")"
check "trusted_authors extends trust" "61 OPEN" "$(trusted_authors=agent-bot2 bash -c 'source "$1"; prs_for_issue 12' _ "$LIB")"

echo "Shared marker fixtures (the same cases tests/helpers.test.mjs runs)"
FIX="$PKG/tests/fixtures/markers.json"
for i in $(jq -r 'keys[]' "$FIX"); do
  name=$(jq -r ".[$i].name" "$FIX"); n=$((900 + i))
  echo '[]' > "$STATE/comments_$n.json"
  jq --argjson i "$i" '[.[$i].comments[] | {body, author_association:(.author_association // "OWNER"), user:{login:(.login // "maintainer")}}]' "$FIX" > "$STATE/comments_$n.json"
  extra=$(jq -r ".[$i].trusted_authors // [] | join(\",\")" "$FIX")
  run() { trusted_authors="$extra" bash -c 'source "$1"; shift; "$@"' _ "$LIB" "$@"; }
  for k in review_rounds open_findings ready_sha shepherd_attempts; do
    if [ "$(jq ".[$i].expect | has(\"$k\")" "$FIX")" = true ]; then
      check "$name: $k" "$(jq -r ".[$i].expect.$k" "$FIX")" "$(run "$k" "$n")"
    fi
  done
  for step in $(jq -r ".[$i].expect.failures // {} | keys[]" "$FIX"); do
    check "$name: failures $step" "$(jq -r ".[$i].expect.failures.$step" "$FIX")" "$(run failures "$n" "$step")"
  done
  if [ "$(jq ".[$i].expect | has(\"lease_live\")" "$FIX")" = true ]; then
    run lease_live "$n"; got=$?; want=$([ "$(jq ".[$i].expect.lease_live" "$FIX")" = true ] && echo 0 || echo 1)
    check "$name: lease_live" "$want" "$got"
  fi
done

echo "Deprecated names and duration forms"
check "groom_batch still sets triage_batch" "7" "$(groom_batch=7 bash -c 'source "$1"; echo "$triage_batch"' _ "$LIB")"
check "triage_batch wins over groom_batch"  "2" "$(groom_batch=7 triage_batch=2 bash -c 'source "$1"; echo "$triage_batch"' _ "$LIB")"
check "issues_per_run still sets explore_batch" "9" "$(issues_per_run=9 bash -c 'source "$1"; echo "$explore_batch"' _ "$LIB")"
check "explore_batch default" "5" "$(bash -c 'source "$1"; echo "$explore_batch"' _ "$LIB")"
check "runner default feeds RUN_ID" "unknown" "$(env -u RUN_ID bash -c 'source "$1"; echo "${RUN_ID##*-}"' _ "$LIB")"
check "runner is in RUN_ID" "grok" "$(env -u RUN_ID runner=grok bash -c 'source "$1"; echo "${RUN_ID##*-}"' _ "$LIB")"
for ttl in "1 hour" 1h PT1H; do
  claim 31 issue agent:triage Triaging "$ttl"; lease_live 31; check "claim takes ttl '$ttl'" 0 $?
  release 31 issue agent:triage
done

echo; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
