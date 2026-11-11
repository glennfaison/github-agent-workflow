#!/usr/bin/env bash
# Tests for the shell helpers in agent-workflow-protocol/scripts/lib.sh, against the `gh` simulator (tests/sim).
#   bash tests/lib.test.sh
# Needs bash, jq, git and Node.js. No network and no real `gh`.
set -u

# Fail once, with one line, when a tool the simulator `gh` or the tests rely on is missing. Without this
# the suite keeps going and reports dozens of failures that are really one missing tool.
for tool in jq git node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "tests/lib.test.sh needs $tool on PATH" >&2; exit 2; }
done

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="$PKG/skills/meta/agent-workflow-protocol/scripts/lib.sh"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
export STATE="$WORK/state"; mkdir -p "$STATE" "$WORK/bin" "$WORK/repo"

# ---- The gh simulator ---------------------------------------------------------------------
# tests/sim/bin/gh answers `gh` from a world file (the scenarios' format) and logs every call. It is the one mock of
# `gh` in this package, and it is as strict as `gh`: a `--json` field `gh` does not have is an error here too.
# The world is $STATE/world.json. A test sets it up with `w PROGRAM` (jq over the world) and the helpers below, runs the
# functions under test, and reads the result back through `gh` itself.
export GH_SIM_WORLD="$STATE/world.json" GH_SIM_LOG="$STATE/gh.log"
echo '{"issues":[],"prs":[],"files":{}}' > "$GH_SIM_WORLD"
export PATH="$PKG/tests/sim/bin:$PATH"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
w() { jq "$@" "$GH_SIM_WORLD" > "$GH_SIM_WORLD.t" && mv "$GH_SIM_WORLD.t" "$GH_SIM_WORLD"; }   # w [--arg k v ...] PROGRAM
items() { # FROM TO -> open issues FROM..TO, those that are not there yet
  w --argjson a "$1" --argjson b "$2" '.issues += [range($a; $b + 1) as $n | select([.issues[].number] | index($n) | not) | {number:$n,state:"open",labels:[]}]'; }
ensure() { w --argjson n "$1" 'if ([.issues[].number, .prs[].number] | index($n)) then . else .issues += [{number:$n,state:"open",labels:[]}] end'; }
mkpr() { w --argjson n "$1" 'if (.prs | map(.number) | index($n)) then . else .prs += [{number:$n,state:"open",labels:[]}] end'; }
mk_issue() { # title body label -> prints the new number, as `gh issue create` would number it
  local num; num=$(( $(jq '[.issues[].number, .prs[].number] | max // 0' "$GH_SIM_WORLD") + 1 ))
  w --argjson n "$num" --arg t "$1" --arg b "$2" --arg l "$3" --arg c "$(now_iso)" '.issues += [{number:$n,title:$t,state:"open",labels:[$l],createdAt:$c,body:$b}]'
  echo "$num"
}
c() { ensure "$1"   # c N body [association] [login] [updated_at]: a comment on issue or PR N
  w --argjson n "$1" --arg b "$2" --arg a "${3:-OWNER}" --arg l "${4:-maintainer}" --arg t "${5:-}" '
    def add: .comments = ((.comments // []) + [{author:$l, association:$a, text:$b} + (if $t == "" then {} else {createdAt:$t, updatedAt:$t} end)]);
    .issues |= map(if .number == $n then add else . end) | .prs |= map(if .number == $n then add else . end)'; }
cr() { ensure "$1"   # cr N body created_at [association] [login]
  w --argjson n "$1" --arg b "$2" --arg t "$3" --arg a "${4:-OWNER}" --arg l "${5:-maintainer}" '
    def add: .comments = ((.comments // []) + [{author:$l, association:$a, text:$b, createdAt:$t}]);
    .issues |= map(if .number == $n then add else . end) | .prs |= map(if .number == $n then add else . end)'; }
setfiles() { local n=$1; shift; mkpr "$n"   # setfiles N path...: the files PR N changes
  w --argjson n "$n" --argjson f "$(jq -n '$ARGS.positional' --args "$@")" '.prs |= map(if .number == $n then .files = $f else . end)'; }
set_prs() { # PRs as [{number,state:OPEN|MERGED|CLOSED,title,body,headRefName,author:{login},authorAssociation,closing:[numbers]}] on stdin
  w --argjson p "$(jq 'map({number, state:(.state | ascii_downcase), title, body, branch:.headRefName, closes:(.closing // []), association:.authorAssociation, author:.author.login} | with_entries(select(.value != null)))')" '.prs = $p'; }
cj() { gh api "repos/{owner}/{repo}/issues/$1/comments" --paginate; }   # an item's comments, as the REST API gives them
ij() { gh issue list --state all --limit 1000 --json number,title,state,labels,createdAt,body --jq 'map({number,title,state:(.state | ascii_downcase),labels:(.labels | map(.name)),createdAt,body}) | sort_by(.number)'; }   # every issue, oldest first
fault() { w --argjson f "$1" '.faults = $f'; }   # fault '[{"match":"api -X PATCH","fail":"HTTP 500"}]': the next matching calls fail
no_faults() { w 'del(.faults)'; }

# lib.sh needs to run inside a git repository, but not this one
git init -q "$WORK/repo" && cd "$WORK/repo" || exit 1

pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ok   $1"; else fail=$((fail+1)); echo "  FAIL $1  (expected '$2', got '$3')"; fi
}
lease_comments() { cj "$1" | jq '[.[] | select(.body | contains("<!-- agent:lease"))] | length'; }   # lease comments on N

echo "Defaults"
( set -e; source "$LIB" ); check "sourcing with set -e survives, and no config file is needed" 0 $?
check "pr_base_branch default"  "main"          "$(bash -c 'source "$1"; echo "$pr_base_branch"' _ "$LIB")"
check "triage_batch default"     "5"             "$(bash -c 'source "$1"; echo "$triage_batch"' _ "$LIB")"
check "merge_method default"    "squash"        "$(bash -c 'source "$1"; echo "$merge_method"' _ "$LIB")"
check "build_cmd default empty" ""              "$(bash -c 'source "$1"; echo "$build_cmd"' _ "$LIB")"
check "lower and upper match"   "1 hour:1 hour" "$(bash -c 'source "$1"; echo "$lease_ttl_triage:$LEASE_TTL_TRIAGE"' _ "$LIB")"
check "human_merge_paths default empty" "" "$(bash -c 'source "$1"; echo "$human_merge_paths"' _ "$LIB")"
check "ready_lane_ttl default"   "2 hours:2 hours" "$(bash -c 'source "$1"; echo "$ready_lane_ttl:$READY_LANE_TTL"' _ "$LIB")"

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
items 1 40   # gh refuses to edit an issue that is not there
# And it refuses a label the repository does not have, so the repository starts as `setup-github-agent-workflow` leaves it.
w --argjson l "$(grep -o '^gh label create "[^"]*"' "$PKG/skills/meta/agent-workflow-protocol/references/labels.md" | sed 's/^gh label create "\(.*\)"$/\1/' | jq -R '{name:.}' | jq -s .)" '.labels = $l'

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

echo "One lease comment per step"
claim 5 issue agent:triage Triaging "1 hour"; release 5 issue agent:triage
claim 5 issue agent:triage Triaging "1 hour"; release 5 issue agent:triage
claim 5 issue agent:triage Triaging "3 hours"
check "three claims of one step leave one lease comment" 1 "$(lease_comments 5)"
lease_live 5;                    check "and it is live" 0 $?
check "and it carries the newest expiry" "$(utc_plus '3 hours' | cut -c1-15)" "$(cj 5 | jq -r '.[0].body' | sed -n 's/.*expires=\([0-9TZ:-]*\).*/\1/p' | cut -c1-15)"
release 5 issue agent:triage
claim 5 issue agent:in-progress Implementing "3 hours"
check "another step gets a lease comment of its own" 2 "$(lease_comments 5)"
renew 5 issue Triaging "2 hours"
check "renew edits the step's lease comment too" 2 "$(lease_comments 5)"
check "and says it was renewed" 1 "$(cj 5 | jq '[.[] | select(.body | startswith("Lease renewed by Triaging"))] | length')"
check "claiming does not touch a comment of another step" 1 "$(cj 5 | jq '[.[] | select(.body | startswith("Claimed by Implementing"))] | length')"
c 6 "Claimed by Triaging run z until 2099-01-01T00:00:00Z.
<!-- agent:lease step=Triaging run=z expires=2099-01-01T00:00:00Z -->" NONE mallory
claim 6 issue agent:triage Triaging "1 hour"
check "a lease comment from another account is never edited, ours is added" 2 "$(lease_comments 6)"
check "and the other account's comment is unchanged" 1 "$(cj 6 | jq '[.[] | select(.user.login == "mallory" and (.body | startswith("Claimed by Triaging run z")))] | length')"
fault '[{"match":"api -X PATCH","fail":"gh: Internal Server Error (HTTP 500)"}]'
claim 8 issue agent:triage Triaging "1 hour"
claim 8 issue agent:triage Triaging "1 hour"
no_faults
check "if the edit fails, the claim still posts a lease comment" 2 "$(lease_comments 8)"
lease_live 8;                    check "and the item is leased" 0 $?
# Edited in place, a lease comment can sit before a newer lease of another step: the last write wins.
c 7 "x <!-- agent:lease step=Triaging run=a expires=2099-01-01T00:00:00Z -->" OWNER maintainer 2026-03-01T00:00:00Z
c 7 "x <!-- agent:lease step=Implementing run=b expires=2020-01-01T00:00:00Z -->" OWNER maintainer 2026-02-01T00:00:00Z
lease_live 7;                    check "the lease written last wins, not the one posted last" 0 $?

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

echo "Merge lane"
prs_saved=$(jq -c .prs "$GH_SIM_WORLD")
rdy() { # N [draft] [extra label] -> a PR that carries the ready label
  jq -nc --argjson n "$1" --argjson d "${2:-false}" --arg x "${3:-}" '{number:$n,state:"open",draft:$d,labels:(["agent:ready-for-review"] + (if $x == "" then [] else [$x] end))}'; }
w --argjson p "[$(rdy 50),$(rdy 51 true),$(rdy 52 false agent:stuck),$(rdy 53)]" '.prs = $p'
READY="ready <!-- agent:handoff kind=ready sha=aaa -->"
cr 50 "$READY" "$(utc_plus '-30 minutes')"
cr 51 "$READY" "$(utc_plus '-5 minutes')"
cr 52 "$READY" "$(utc_plus '-5 minutes')"
cr 53 "$READY" "$(utc_plus '-5 minutes')" NONE mallory
check "a fresh ready PR holds the lane; a draft, a stuck PR and a stranger's marker do not" 50 "$(lane_holder 60)"
lane_holder 60 >/dev/null;  check "lane_holder returns 0 when held" 0 $?
check "a PR is never its own holder" "" "$(lane_holder 50)"
lane_holder 50 >/dev/null;  check "lane_holder returns 1 when free" 1 $?
w '.prs |= map(if .number == 50 then del(.comments) else . end)'; cr 50 "$READY" "$(utc_plus '-3 hours')"
check "a handoff past ready_lane_ttl no longer holds the lane" "" "$(lane_holder 60)"
check "ready_at is the handoff time" "$(cj 50 | jq -r '.[0].created_at')" "$(ready_at 50)"
ready_lane_ttl="4 hours"
check "a longer ready_lane_ttl keeps it held" 50 "$(lane_holder 60)"
ready_lane_ttl="2 hours"
w '.prs = []'
check "no ready PRs, a free lane" "" "$(lane_holder 60)"
w --argjson p "$prs_saved" '.prs = $p'

echo "Protected paths and owners"
setfiles 70 README.md skills/x/SKILL.md docs/a.md
human_merge_paths=""
check "no human_merge_paths protects nothing" "" "$(protected_files 70)"
protected_files 70 >/dev/null;  check "and the status is 0" 0 $?
human_merge_paths="skills/**/SKILL.md,/scripts/"
check "a changed file that matches is listed" "skills/x/SKILL.md" "$(protected_files 70)"
setfiles 71 README.md docs/a.md
check "no matching file prints nothing" "" "$(protected_files 71)"
protected_files 71 >/dev/null;  check "with status 0" 0 $?
mkpr 72; w '.prs |= map(if .number == 72 then .files = [{path:"docs/b.md",previous:"scripts/old.sh"}] else . end)'
check "the old name of a renamed file counts" "scripts/old.sh" "$(protected_files 72)"
protected_files 79 >/dev/null 2>&1;  check "an unreadable file list fails closed (status 2)" 2 $?
setfiles 73
protected_files 73 >/dev/null 2>&1;  check "an empty file list fails closed too" 2 $?
human_merge_paths="!skills/"
protected_files 70 >/dev/null 2>&1;  rc=$?;  check "an unsupported pattern fails (never reads as 'nothing protected')" 1 "$([ $rc -ne 0 ] && echo 1 || echo 0)"
human_merge_paths=""
w --arg t "$(printf '# owners\n* @root\n/docs/ @docs-team @org/writers\n')" '.files[".github/CODEOWNERS"] = $t'
setfiles 74 docs/a.md README.md
check "owners come from CODEOWNERS on the base branch" "$(printf '@docs-team\n@org/writers\n@root')" "$(codeowners_for 74)"
w --arg t "$(printf '* @from-docs-dir\n')" '.files["docs/CODEOWNERS"] = $t'
check ".github/CODEOWNERS wins over docs/CODEOWNERS" "$(printf '@docs-team\n@org/writers\n@root')" "$(codeowners_for 74)"
w 'del(.files[".github/CODEOWNERS"])'
check "and docs/CODEOWNERS is used when it is the only one" "@from-docs-dir" "$(codeowners_for 74)"
w '.files = {}'
check "no CODEOWNERS file means no owners" "" "$(codeowners_for 74)"
codeowners_for 74 >/dev/null;  check "and it is not an error" 0 $?

echo "Run log"
w '.issues = [] | .prs = []'   # earlier sections used the same numbers, and issues and PRs share one sequence
old_iso=$(utc_plus "-30 days"); week_iso=$(utc_plus "-3 days"); stale_iso=$(utc_plus "-20 days")
legacy_body="Append-only run log: one comment per run. Covers roughly two weeks. Excluded from every workflow step."
issues_with() { # number created_at -> a lone legacy log issue (its body carries no dates)
  w --argjson n "$1" --arg c "$2" --arg b "$legacy_body" '.issues = [{number:$n,title:"Agent log old",state:"open",labels:["agent:log"],createdAt:$c,body:$b}]'; }
entry() { # RUN STEP PROBLEMS -> an entry file, the way a runner writes one
  printf '```yaml\nstep: %s\nrun: %s\nrunner: kilo\noutcome: "1 triaged"\nproblems_count: 0\n```\n**Step:** %s  **Run:** %s  **Runner:** kilo\n**Outcome:** 1 triaged\n**Problems:** %s\n**Things to improve:** none\n' \
    "$2" "$1" "$2" "$1" "$3" > "$WORK/entry-$1.md"; echo "$WORK/entry-$1.md"; }

w '.issues = []'
n1=$(log_issue); n2=$(log_issue); n3=$(log_issue)
check "log_issue makes one issue, not one per call" 1 "$(ij | jq length)"
check "log_issue returns the same issue each time" "$n1,$n1" "$n2,$n3"
check "the log issue is labelled agent:log" agent:log "$(ij | jq -r '.[0].labels[0]')"
check "the log issue body says when the window rotates" 1 "$(ij | jq -r '.[0].body' | grep -c 'Rotates after:\*\* 20')"
check "the log issue body has a Last entry line" 1 "$(ij | jq -r '.[0].body' | grep -c 'Last entry:')"
check "title is Agent log YYYY-MM-DD" 1 "$(ij | jq -r '.[0].title' | grep -Ec '^Agent log [0-9]{4}-[0-9]{2}-[0-9]{2}$')"

e1=$(entry R-1 Triaging "degraded: browser missing")
log_run "$e1"; log_run "$e1"
check "log_run posts an entry once, even when called twice" 1 "$(cj $n1 | jq length)"
check "the entry carries an at: time" 1 "$(cj $n1 | jq -r '.[0].body' | grep -c '^at: 20')"
check "the issue body names the last entry" 1 "$(ij | jq -r '.[0].body' | grep -c 'Last entry:\*\* 20[0-9:TZ-]* (Triaging, run R-1)')"
check "problems do not open a difficulty issue" 1 "$(ij | jq length)"
log_run "$(entry R-2 Triaging none)"
log_run "$(entry R-2 Shepherding none)"
check "another run, and another step of the same run, each get an entry" 3 "$(cj $n1 | jq length)"
check "log_status says when the log was last written" 1 "$(log_status | grep -c '^last_entry=20')"

printf '%s' '\n\n**Step:** Reviewing  **Run:** R-3  **Runner:** kilo\n**Outcome:** 1 merged\n**Problems:** none\n' > "$WORK/escaped.md"
log_run "$WORK/escaped.md"
check "an entry written with literal \\n gets real line breaks" 1 "$(cj $n1 | jq -r '.[-1].body' | grep -c '^\*\*Outcome:\*\* 1 merged$')"
check "and an at: time" 1 "$(cj $n1 | jq -r '.[-1].body' | grep -c '^\*\*At:\*\* 20')"

echo "Run log rotation"
issues_with 50 "$week_iso"
check "an issue inside its window keeps getting entries" 50 "$(log_issue)"
check "and no second issue is made" 1 "$(ij | jq length)"
issues_with 50 "$old_iso"
check "an issue past its window is replaced" 51 "$(log_issue)"
check "the old one is left alone, not closed" open "$(ij | jq -r '.[]|select(.number==50)|.state')"
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

w '.issues = []'
mk_issue "Agent log a" "$legacy_body" agent:log >/dev/null; mk_issue "Agent log b" "$legacy_body" agent:log >/dev/null
check "two open windows: the lowest number is the log" 1 "$(log_issue)"
w '.issues = []'
# another run gets its log issue in ahead of ours
w --arg c "$(now_iso)" '.faults = [{match:"issue create", times:1, before:[{op:"create_issue", number:1, labels:["agent:log"], data:{title:"racing run", body:"", createdAt:$c}}]}]'
got=$(log_issue)
no_faults
check "a run that lost a creation race uses the other run's issue" 1 "$got"
check "and closes its own duplicate" closed "$(ij | jq -r '.[]|select(.number==2)|.state')"

echo "Reading the log"
w '.issues = []'; mk_issue "Agent log" "$legacy_body" agent:log >/dev/null
logc=$(jq 'map({text:.body, createdAt, author:"maintainer", association:"OWNER"})' <<'J'
[{"body":"**Step:** Triaging\n**Outcome:** nothing eligible","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Triaging\n**Outcome:** nothing eligible\n**Problems:** none\n**Things to improve:** none","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Shepherding\n**Outcome:** nothing eligible\n**Problems:** failed: #4 x","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Reviewing\n**Outcome:** 1 merged","createdAt":"2999-01-01T00:00:00Z"},
 {"body":"**Step:** Exploring\n**Outcome:** 2 filed (too old)","createdAt":"2000-01-01T00:00:00Z"}]
J
)
w --argjson c "$logc" '.issues[0].comments = $c'
logs=$(read_logs 14)
check "idle entry is skipped"           0 "$(grep -c 'Step:\*\* Triaging' <<<"$logs")"
check "idle entry that says Problems: none is skipped too" 0 "$(grep -c 'Things to improve' <<<"$logs")"
check "idle entry with Problems is kept" 1 "$(grep -c 'Step:\*\* Shepherding' <<<"$logs")"
check "working entry is kept"           1 "$(grep -c 'Step:\*\* Reviewing' <<<"$logs")"
check "entry older than the window is dropped" 0 "$(grep -c 'Exploring' <<<"$logs")"

echo "Issue <-> PR links"
set_prs <<'J'
[{"number":50,"state":"OPEN","body":"x\n<!-- agent:implements issue=7 -->","headRefName":"feature/7-foo","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":51,"state":"MERGED","body":"Closes #8.","headRefName":"bugfix/zzz","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":52,"state":"CLOSED","body":"nothing","headRefName":"feature/9-bar","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":53,"state":"OPEN","body":"Closes #70.","headRefName":"feature/x","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":54,"state":"OPEN","title":"Fixes some/repo#80: thing","body":"nothing","headRefName":"x","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":55,"state":"OPEN","title":"Implements #81","body":"nothing","headRefName":"x","closing":[],"authorAssociation":"OWNER","author":{"login":"maintainer"}},
 {"number":56,"state":"OPEN","body":"<!-- agent:implements issue=13 -->","headRefName":"x","closing":[],"authorAssociation":"MEMBER","author":{"login":"dev"}},
 {"number":57,"state":"OPEN","body":"nothing","headRefName":"y","closing":[14],"authorAssociation":"COLLABORATOR","author":{"login":"dev"}},
 {"number":58,"state":"MERGED","body":"Closes #15\n<!-- agent:implements issue=16 -->","headRefName":"z","closing":[15,3],"authorAssociation":"OWNER","author":{"login":"maintainer"}}]
J
check "link by marker+branch"  "50 OPEN"   "$(prs_for_issue 7)"
check "link by Closes text"    "51 MERGED" "$(prs_for_issue 8)"
check "link by branch only"    "52 CLOSED" "$(prs_for_issue 9)"
check "#7 must not match #70"  "53 OPEN"   "$(prs_for_issue 70)"
check "link by title (owner/repo#N)" "54 OPEN" "$(prs_for_issue 80)"
check "link by title (Implements #N)" "55 OPEN" "$(prs_for_issue 81)"
check "issue_for_pr (marker)"  7 "$(issue_for_pr 50)"
check "issue_for_pr (Closes)"  8 "$(issue_for_pr 51)"
check "a MEMBER's marker is a link"                "56 OPEN" "$(prs_for_issue 13)"
check "issue_for_pr reads GitHub's own links"      14        "$(issue_for_pr 57)"
check "issue_for_pr joins the body and GitHub's links, once each, in numeric order" "3 15 16" "$(issue_for_pr 58 | tr '\n' ' ' | sed 's/ $//')"
fault '[{"match":"pr view","fail":"Unknown JSON field: \"closingIssuesReferences\"\nAvailable fields:\n  additions"}]'   # gh before 2.72
check "an old gh without closingIssuesReferences still reads the body" "8" "$(issue_for_pr 51)"
no_faults
issue_for_pr 999 >/dev/null 2>&1;  check "issue_for_pr fails for a PR that is not there" 1 $?
gh pr list --json number,authorAssociation >/dev/null 2>&1;  check "gh has no authorAssociation on pr list (the simulator refuses it as gh does)" 1 $?
gh pr view 50 --json body,authorAssociation >/dev/null 2>&1; check "gh has no authorAssociation on pr view either" 1 $?
jq -n '[range(1;231) | {number:(1000+.),state:"CLOSED",body:"",headRefName:"x",closing:[],authorAssociation:"NONE",author:{login:"z"}}]
       | .[119] |= (.body="<!-- agent:implements issue=20 -->" | .authorAssociation="OWNER")
       | .[9] |= (.body="<!-- agent:implements issue=21 -->" | .authorAssociation="OWNER")' | set_prs
check "a PR on the second page of PRs is found"          "1120 CLOSED" "$(prs_for_issue 20)"
check "a PR past the 200 newest is not (the cap is as it was)" ""     "$(prs_for_issue 21)"

echo "Trust"
set_prs <<'J'
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
  ensure "$n"
  w --argjson n "$n" --argjson c "$(jq --argjson i "$i" '[.[$i].comments[] | {text:.body, association:(.author_association // "OWNER"), author:(.login // "maintainer")} + (if .updated_at then {createdAt:.updated_at, updatedAt:.updated_at} else {} end)]' "$FIX")" '.issues |= map(if .number == $n then .comments = $c else . end)'
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

echo "Nested calls borrow the caller's lease"
items 1 40   # the run log section started from an empty repository
check "lease_held default" "false" "$(bash -c 'source "$1"; echo "$lease_held"' _ "$LIB")"
lease_held=true claim 33 issue agent:triage Triaging 1h
has_label 33 issue agent:triage; check "claim does nothing when lease_held=true" 1 $?
claim 34 issue agent:triage Triaging 1h
lease_held=true release 34 issue agent:triage
has_label 34 issue agent:triage; check "release does nothing when lease_held=true" 0 $?
release 34 issue agent:triage
has_label 34 issue agent:triage; check "release still works when lease_held is not set" 1 $?

echo "Deprecated names and duration forms"
check "groom_batch still sets triage_batch" "7" "$(groom_batch=7 bash -c 'source "$1"; echo "$triage_batch"' _ "$LIB")"
check "triage_batch wins over groom_batch"  "2" "$(groom_batch=7 triage_batch=2 bash -c 'source "$1"; echo "$triage_batch"' _ "$LIB")"
check "issues_per_run still sets explore_batch" "9" "$(issues_per_run=9 bash -c 'source "$1"; echo "$explore_batch"' _ "$LIB")"
check "write_log default" "true" "$(bash -c 'source "$1"; echo "$write_log"' _ "$LIB")"
check "write_log can be set" "false" "$(write_log=false bash -c 'source "$1"; echo "$WRITE_LOG"' _ "$LIB")"
check "explore_batch default" "5" "$(bash -c 'source "$1"; echo "$explore_batch"' _ "$LIB")"
check "runner default feeds RUN_ID" "unknown" "$(env -u RUN_ID bash -c 'source "$1"; echo "${RUN_ID##*-}"' _ "$LIB")"
check "runner is in RUN_ID" "grok" "$(env -u RUN_ID runner=grok bash -c 'source "$1"; echo "${RUN_ID##*-}"' _ "$LIB")"
for ttl in "1 hour" 1h PT1H; do
  claim 31 issue agent:triage Triaging "$ttl"; lease_live 31; check "claim takes ttl '$ttl'" 0 $?
  release 31 issue agent:triage
done


echo "Client guidance"
w '.files = {"README.md":"","AGENTS.md":"","docs/CONTRIBUTING.md":"",".github/copilot-instructions.md":"",".github/ISSUE_TEMPLATE/bug.yml":"","src/AGENTS.md":"","node_modules/x/AGENTS.md":"","docs/house-rules.md":""}'
check "client_guidance_files finds the standard files" \
  ".github/ISSUE_TEMPLATE/bug.yml,.github/copilot-instructions.md,AGENTS.md,docs/CONTRIBUTING.md,src/AGENTS.md" \
  "$(client_guidance_files | paste -sd, -)"
check "repo_guidance adds a file the standard list misses" \
  ".github/ISSUE_TEMPLATE/bug.yml,.github/copilot-instructions.md,AGENTS.md,docs/CONTRIBUTING.md,docs/house-rules.md,src/AGENTS.md" \
  "$(repo_guidance='docs/house-rules.md' client_guidance_files | paste -sd, -)"
w '.labels = [{"name":"evergreen","description":"Recurring enhancement that stays open indefinitely"},{"name":"bug","description":"Something is broken"}] | .issues += [{number:90,state:"open",labels:["evergreen"]}]'
check "item_labels prints the label description" "evergreen: Recurring enhancement that stays open indefinitely" "$(item_labels 90 issue)"
w '.issues += [{number:91,state:"open",labels:["evergreen","no-description"]}]'
check "item_labels keeps a label with no description" "evergreen: Recurring enhancement that stays open indefinitely|no-description: " "$(item_labels 91 issue | paste -sd'|' -)"

echo "The gh simulator"
# A call the simulator does not cover fails, and a helper may swallow the failure. The log does not forget it.
check "no call in this run was one the simulator does not cover" "" "$(jq -r 'select(.kind == "unsupported") | .argv | join(" ")' "$GH_SIM_LOG")"
check "the log recorded the calls the tests made" 1 "$([ "$(wc -l < "$GH_SIM_LOG")" -gt 300 ] && echo 1 || echo 0)"

echo; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
