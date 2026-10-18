#!/usr/bin/env bash
# Tests for the shell helpers in agent-workflow-protocol/scripts/lib.sh, against a stub `gh`.
#   bash tests/lib.test.sh
# Needs bash, jq, git and Node.js. No network and no real `gh`.
set -u

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="$PKG/skills/meta/agent-workflow-protocol/scripts/lib.sh"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
export STATE="$WORK/state"; mkdir -p "$STATE" "$WORK/bin" "$WORK/repo"
echo '[]' > "$STATE/prs.json"; echo '[]' > "$STATE/issues.json"

# ---- Stub gh: file-backed, covers only the calls lib.sh makes ------------------------------
cat > "$WORK/bin/gh" <<'STUB'
#!/usr/bin/env bash
cmd=$1; shift
if [ "$cmd" = pr ] && [ "${1:-}" = list ]; then cat "$STATE/prs.json"; exit 0; fi
jqf() { local f=""; while [ $# -gt 0 ]; do [ "$1" = --jq ] && f=$2; shift; done; jq -r "${f:-.}"; }
# Issues live in $STATE/issues.json: [{number,title,state,labels:[names],createdAt,updatedAt,body}].
# Unlike a stub that returns a fixed list, this one makes a lookup that finds nothing actually find
# nothing, which is how the "a new log issue on every run" bug got past the tests.
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
mk_issue() { # title body label  -> prints the new number
  local num; num=$(( $(jq 'map(.number) | max // 0' "$STATE/issues.json") + 1 ))
  jq --argjson n "$num" --arg t "$1" --arg b "$2" --arg l "$3" --arg c "$(now_iso)" \
     '. + [{number:$n,title:$t,state:"open",labels:[$l],createdAt:$c,updatedAt:$c,body:$b}]' "$STATE/issues.json" > "$STATE/issues.t"
  mv "$STATE/issues.t" "$STATE/issues.json"; echo "$num"
}
set_issue() { jq --argjson n "$1" --arg k "$2" --arg v "$3" 'map(if .number==$n then .[$k]=$v else . end)' "$STATE/issues.json" > "$STATE/issues.t"; mv "$STATE/issues.t" "$STATE/issues.json"; }
if [ "$cmd" = label ]; then exit 0; fi
if [ "$cmd" = issue ] && [ "${1:-}" = list ]; then
  shift; orig=("$@"); lab=""; st=open
  while [ $# -gt 0 ]; do case $1 in --label) lab=$2; shift ;; --state) st=$2; shift ;; esac; shift; done
  jq -c --arg l "$lab" --arg s "$st" 'map(select(($l=="" or (.labels|index($l))) and ($s=="all" or .state==$s))) | sort_by(-.number)' "$STATE/issues.json" | jqf "${orig[@]}"
  exit 0
fi
if [ "$cmd" = issue ] && [ "${1:-}" = create ]; then
  shift; title=""; body=""; lab=""
  while [ $# -gt 0 ]; do case $1 in --title) title=$2; shift ;; --body) body=$2; shift ;; --label) lab=$2; shift ;; esac; shift; done
  [ -n "${STUB_RACE:-}" ] && mk_issue "racing run" "" "$lab" >/dev/null   # another run got in first
  echo "https://github.com/o/r/issues/$(mk_issue "$title" "$body" "$lab")"; exit 0
fi
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
            elif [ "$cmd" = issue ] && [[ "$*" == *createdAt* ]]; then
              jq --argjson n "$n" '.[]|select(.number==$n)' "$STATE/issues.json" | jqf "$@"
            elif [ "$cmd" = pr ] && [[ " $* " == *closingIssuesReferences* ]]; then
              jq --argjson n "$n" '.[]|select(.number==$n)|{body,authorAssociation,author,closingIssuesReferences:(.closing//[])|map({number:.})}' "$STATE/prs.json" | jqf "$@"
            else jq -Rn '{labels:[inputs|select(length>0)|{name:.}]}' "$lf" | jqf "$@"; fi ;;
      close) while [ $# -gt 0 ]; do case $1 in --reason) set_issue "$n" closeReason "$2"; shift ;; esac; shift; done
             set_issue "$n" state closed ;;
      edit) while [ $# -gt 0 ]; do case $1 in
              --body-file)    set_issue "$n" body "$(cat "$2")"; shift ;;
              --add-label)    grep -qx -- "$2" "$lf" || echo "$2" >> "$lf"; shift ;;
              --remove-label) grep -vx -- "$2" "$lf" > "$lf.t"; mv "$lf.t" "$lf"; shift ;; esac; shift; done ;;
      comment) body=""; while [ $# -gt 0 ]; do [ "$1" = --body ] && body=$2; [ "$1" = --body-file ] && body=$(cat "$2"); shift; done
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
rm -f "$STATE"/comments_*.json   # earlier sections used the same issue numbers
mk_issue() { # title body label -> a log issue in the stub's store, as `gh issue create` would
  local num; num=$(( $(jq 'map(.number) | max // 0' "$STATE/issues.json") + 1 ))
  jq --argjson n "$num" --arg t "$1" --arg b "$2" --arg l "$3" --arg c "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     '. + [{number:$n,title:$t,state:"open",labels:[$l],createdAt:$c,updatedAt:$c,body:$b}]' "$STATE/issues.json" > "$STATE/issues.t"
  mv "$STATE/issues.t" "$STATE/issues.json"; echo "$num"
}
old_iso=$(utc_plus "-30 days"); week_iso=$(utc_plus "-3 days"); stale_iso=$(utc_plus "-20 days")
legacy_body="Append-only run log: one comment per run. Covers roughly two weeks. Excluded from every workflow step."
issues_with() { # number created_at -> a lone legacy log issue (its body carries no dates)
  jq -n --argjson n "$1" --arg c "$2" --arg b "$legacy_body" \
    '[{number:$n,title:"Agent log old",state:"open",labels:["agent:log"],createdAt:$c,updatedAt:$c,body:$b}]' > "$STATE/issues.json"; }
entry() { # RUN STEP PROBLEMS -> an entry file, the way a runner writes one
  printf '```yaml\nstep: %s\nrun: %s\nrunner: kilo\noutcome: "1 triaged"\nproblems_count: 0\n```\n**Step:** %s  **Run:** %s  **Runner:** kilo\n**Outcome:** 1 triaged\n**Problems:** %s\n**Things to improve:** none\n' \
    "$2" "$1" "$2" "$1" "$3" > "$WORK/entry-$1.md"; echo "$WORK/entry-$1.md"; }

echo '[]' > "$STATE/issues.json"
n1=$(log_issue); n2=$(log_issue); n3=$(log_issue)
check "log_issue makes one issue, not one per call" 1 "$(jq length "$STATE/issues.json")"
check "log_issue returns the same issue each time" "$n1,$n1" "$n2,$n3"
check "the log issue is labelled agent:log" agent:log "$(jq -r '.[0].labels[0]' "$STATE/issues.json")"
check "the log issue body says when the window rotates" 1 "$(jq -r '.[0].body' "$STATE/issues.json" | grep -c 'Rotates after:\*\* 20')"
check "the log issue body has a Last entry line" 1 "$(jq -r '.[0].body' "$STATE/issues.json" | grep -c 'Last entry:')"
check "title is Agent log YYYY-MM-DD" 1 "$(jq -r '.[0].title' "$STATE/issues.json" | grep -Ec '^Agent log [0-9]{4}-[0-9]{2}-[0-9]{2}$')"

e1=$(entry R-1 Triaging "degraded: browser missing")
log_run "$e1"; log_run "$e1"
check "log_run posts an entry once, even when called twice" 1 "$(jq length "$STATE/comments_$n1.json")"
check "the entry carries an at: time" 1 "$(jq -r '.[0].body' "$STATE/comments_$n1.json" | grep -c '^at: 20')"
check "the issue body names the last entry" 1 "$(jq -r '.[0].body' "$STATE/issues.json" | grep -c 'Last entry:\*\* 20[0-9:TZ-]* (Triaging, run R-1)')"
check "problems do not open a difficulty issue" 1 "$(jq length "$STATE/issues.json")"
log_run "$(entry R-2 Triaging none)"
log_run "$(entry R-2 Shepherding none)"
check "another run, and another step of the same run, each get an entry" 3 "$(jq length "$STATE/comments_$n1.json")"
check "log_status says when the log was last written" 1 "$(log_status | grep -c '^last_entry=20')"

printf '%s' '\n\n**Step:** Reviewing  **Run:** R-3  **Runner:** kilo\n**Outcome:** 1 merged\n**Problems:** none\n' > "$WORK/escaped.md"
log_run "$WORK/escaped.md"
check "an entry written with literal \\n gets real line breaks" 1 "$(jq -r '.[-1].body' "$STATE/comments_$n1.json" | grep -c '^\*\*Outcome:\*\* 1 merged$')"
check "and an at: time" 1 "$(jq -r '.[-1].body' "$STATE/comments_$n1.json" | grep -c '^\*\*At:\*\* 20')"

echo "Run log rotation"
issues_with 50 "$week_iso"
check "an issue inside its window keeps getting entries" 50 "$(log_issue)"
check "and no second issue is made" 1 "$(jq length "$STATE/issues.json")"
issues_with 50 "$old_iso"
check "an issue past its window is replaced" 51 "$(log_issue)"
check "the old one is left alone, not closed" open "$(jq -r '.[]|select(.number==50)|.state' "$STATE/issues.json")"
issues_with 50 "$stale_iso"
check "20 days old: past the default window of 14" 51 "$(log_issue)"
issues_with 50 "$stale_iso"
check "log_window_days=30 keeps the 20-day-old issue" 50 "$(log_window_days=30 log_issue)"
issues_with 50 "$week_iso"
check "log_window_days=2 retires the 3-day-old issue" 51 "$(log_window_days=2 log_issue)"
check "log_window_days default"  14 "$(env -u log_lookback_days bash -c 'source "$1"; echo "$log_window_days"' _ "$LIB")"
check "log_lookback_days is still read" 7 "$(log_lookback_days=7 bash -c 'source "$1"; echo "$log_window_days"' _ "$LIB")"
check "log_window_days wins over the old name" 3 "$(log_lookback_days=7 log_window_days=3 bash -c 'source "$1"; echo "$log_window_days"' _ "$LIB")"
check "a window that is not a whole number falls back to 14" 14 "$(node "$AGENT_HELPERS" log-window "two weeks")"

echo '[]' > "$STATE/issues.json"
mk_issue "Agent log a" "$legacy_body" agent:log >/dev/null; mk_issue "Agent log b" "$legacy_body" agent:log >/dev/null
check "two open windows: the lowest number is the log" 1 "$(log_issue)"
echo '[]' > "$STATE/issues.json"
got=$(STUB_RACE=1 log_issue)
check "a run that lost a creation race uses the other run's issue" 1 "$got"
check "and closes its own duplicate" closed "$(jq -r '.[]|select(.number==2)|.state' "$STATE/issues.json")"

echo "Reading the log"
echo '[]' > "$STATE/issues.json"; mk_issue "Agent log" "$legacy_body" agent:log >/dev/null
n9=1
cat > "$STATE/comments_$n9.json" <<'J'
[{"body":"**Step:** Triaging\n**Outcome:** nothing eligible","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Triaging\n**Outcome:** nothing eligible\n**Problems:** none\n**Things to improve:** none","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Shepherding\n**Outcome:** nothing eligible\n**Problems:** failed: #4 x","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Reviewing\n**Outcome:** 1 merged","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Exploring\n**Outcome:** 2 filed (too old)","createdAt":"2000-01-01T00:00:00Z"}]
J
logs=$(read_logs 14)
check "idle entry is skipped"           0 "$(grep -c 'Step:\*\* Triaging' <<<"$logs")"
check "idle entry that says Problems: none is skipped too" 0 "$(grep -c 'Things to improve' <<<"$logs")"
check "idle entry with Problems is kept" 1 "$(grep -c 'Step:\*\* Shepherding' <<<"$logs")"
check "working entry is kept"           1 "$(grep -c 'Step:\*\* Reviewing' <<<"$logs")"
check "entry older than the window is dropped" 0 "$(grep -c 'Exploring' <<<"$logs")"

echo "Issue <-> PR links"
cat > "$STATE/prs.json" <<'J'
[{"number":50,"state":"OPEN","body":"x\n<!-- agent:implements issue=7 -->","headRefName":"feature/7-foo","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":51,"state":"MERGED","body":"Closes #8.","headRefName":"bugfix/zzz","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":52,"state":"CLOSED","body":"nothing","headRefName":"feature/9-bar","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":53,"state":"OPEN","body":"Closes #70.","headRefName":"feature/x","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":54,"state":"OPEN","title":"Fixes some/repo#80: thing","body":"nothing","headRefName":"x","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":55,"state":"OPEN","title":"Implements #81","body":"nothing","headRefName":"x","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}}]
J
check "link by marker+branch"  "50 OPEN"   "$(prs_for_issue 7)"
check "link by Closes text"    "51 MERGED" "$(prs_for_issue 8)"
check "link by branch only"    "52 CLOSED" "$(prs_for_issue 9)"
check "#7 must not match #70"  "53 OPEN"   "$(prs_for_issue 70)"
check "link by title (owner/repo#N)" "54 OPEN" "$(prs_for_issue 80)"
check "link by title (Implements #N)" "55 OPEN" "$(prs_for_issue 81)"
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
