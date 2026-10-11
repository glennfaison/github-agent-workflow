---
name: shepherd-github-pr
description: Take one specific GitHub PR by number from opened to reviewable. Fix failing checks and open review findings, or, when checks are green and no findings are open, post the ready handoff and label it agent:ready-for-review. Use when given a PR number to get through CI, or when shepherd-github-prs dispatches one to you.
---

# Shepherd GitHub PR

Take one PR from "opened" to "reviewable": get checks green, address open review findings, then post the handoff. This skill never polls. If checks are still running, it skips the PR and a later run picks it up.

**Input:** a PR URL or number.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/labels.md`, `references/handoff.md`, `references/escalate.md`, `references/log.md` and `config.defaults.env`. Also the repository guidance in `$REPO_GUIDANCE`.

## Eligibility

- `N` is an open PR labelled `agent:needs-work`, without `agent:stuck`.
- If it carries `agent:in-progress` and `lease_live N` succeeds, someone has it: skip.
- Check state is `failing` or `green`. Read it like this (ignore the command's exit code, which is non-zero while checks run):

  ```bash
  gh pr checks N --json bucket --jq '[.[].bucket]
    | if length==0 then "no-checks-yet" elif any(.=="pending") then "pending"
      elif any(.=="fail" or .=="cancel") then "failing" else "green" end'
  ```

  `pending` or `no-checks-yet`: skip. It will be eligible on a later run.

## Outputs

- Fix path: push a commit and post an attempt comment ending with `<!-- agent:attempt step=shepherding sha=<new head SHA> -->`. The PR stays `agent:needs-work`.
- Ready path: a "ready" handoff comment ending with `<!-- agent:handoff kind=ready sha=<head SHA> -->`, then swap `agent:needs-work` → `agent:ready-for-review`.
- Escalation to `agent:stuck` when attempts reach `$MAX_SHEPHERD_ATTEMPTS` or the PR is a fork (`references/escalate.md`).
- Lease released.

## Process

1. **Claim.** `claim N pr agent:in-progress Shepherding "$LEASE_TTL_PR"`. If `failures N Shepherding` is at least `$MAX_ITEM_FAILURES`, follow `references/escalate.md` and stop. Release on every exit path from here on: fixed, handed off, escalated or failed.
2. **Fork check.** `gh pr view N --json isCrossRepository`. If true, follow `references/escalate.md` and stop.
3. **Decide what is needed:**
   - Checks `failing`, or `open_findings N` is above 0: go to step 4.
   - Checks `green` and `open_findings N` is 0: go to step 5.
4. **Fix.**
   1. If `shepherd_attempts N` is at least `$MAX_SHEPHERD_ATTEMPTS`, follow `references/escalate.md` and stop.
   2. Read the failing logs (`gh run view <run-id> --log-failed`) and, if `open_findings N` is above 0, the newest `kind=review` handoff comment. If you cannot read enough of the failing output to find the cause, do not guess: run `fail_item N pr Shepherding "cannot read failing output"`, release, and return `#N failed: cannot read failing output`. This does not count as an attempt.
   3. Check out the PR branch and fix the cause. Run the narrowest relevant test first.
   4. **Never edit tests, snapshots or allowlists to make a check pass.** If a test looks wrong, say so in the attempt comment and leave it.
   5. Push. Post a short comment on what you tried, ending with `<!-- agent:attempt step=shepherding sha=<new head SHA> -->`.
   6. The PR stays `agent:needs-work`. Do not wait for the new checks. Go to step 6.
5. **Hand off.** Post the "ready" handoff on the PR, as `references/handoff.md` describes (changes, decisions, risks, verification, reviewer focus). The comment must end with `<!-- agent:handoff kind=ready sha=<head SHA> -->`. Then in one command: `gh pr edit N --remove-label agent:needs-work --add-label agent:ready-for-review`.
6. **Release.** `release N pr agent:in-progress`.

## Result

Return one line: `#N fix pushed`, `#N ready-for-review`, `#N escalated: <reason>`, `#N skipped: <reason>` or `#N failed: <reason>`.

## Never

- Wait for CI to finish.
- Merge, approve or review. `review-github-pr` does that.
- Apply `agent:ready-for-review` while checks are not green or findings are open.
