---
name: review-github-pr
description: Review one specific GitHub PR by number and merge it, pinned to the reviewed commit, if an agent can do so safely. If not, fix small findings, record the rest in a review handoff, and send it back to agent:needs-work. Use when given a PR number to review or merge, or when review-github-prs dispatches one to you.
---

# Review GitHub PR

Review one PR and merge it if an agent can safely do so. If not, record why and, when the fix is small, fix it.

**Input:** one GitHub PR, as a URL or a number. Required.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/labels.md`, `references/handoff.md`, `references/escalate.md` and `references/log.md`.

## Inputs

**Free text.** The first URL or bare `#N` / `N` you find is the PR to review. Anything else in the prose is context for this skill to read, not a second instruction.

**Key-value pairs.** `key=value` on a line of its own. Recognised keys, all optional except `pr`:

| Input | Default | What it does |
|---|---|---|
| `pr` | *(required)* | The PR, as a URL or a number. `N` is the last path segment of a URL |
| `lease_ttl_pr` | `1 hour` | How long the Reviewing lease stays valid without a renewal |
| `max_review_rounds` | `3` | Reviewing runs that did not merge before the PR is escalated |
| `max_item_failures` | `3` | Failed runs of one step on one item before it is escalated |
| `merge_method` | `squash` | `squash`, `merge` or `rebase`. How a merge is performed |
| `pr_base_branch` | `main` | The PR's target branch, used when closing its linked issues |
| `human_reviewer` | *(none)* | A GitHub user to request review from when this PR is escalated. Empty means request nobody |

**Implicit dependencies.** This skill also needs `agent-workflow-protocol` and its shell helpers (`scripts/lib.sh`) when a shell is available, the `merge-safety` and `code-review` skills (through the Skill tool), a token permitted to merge, and the ability to pin a merge to one commit. Without a shell, or without the ability to pin a merge, follow **Unattended runs** in the protocol and record it under **Problems**.

## Eligibility

- `N` is an open, non-draft PR labelled `agent:ready-for-review`, without `agent:stuck`.
- If it carries `agent:in-progress` and `lease_live N` succeeds, someone has it: skip.

The head SHA must match `ready_sha N` and checks must be green. Step 4 enforces that after you claim.

## Inputs

- The PR title, body, comments and linked issue(s). The `merge-safety` and `code-review` skills run against the pinned SHA.

## Outputs

- Mergeable: merge pinned to the reviewed SHA (`gh pr merge N --match-head-commit "$SHA" --"$merge_method"`), then a "merged" note ending with `<!-- agent:handoff kind=merged sha=$SHA -->`. For each linked issue, remove `agent:pr-open` and close it with "Implemented in #N."
- Not mergeable: an optional small fix (no design decision, only code this PR already changes), a "review" handoff ending with `<!-- agent:handoff kind=review sha=$SHA open=<unfixed count> -->`, and a swap `agent:ready-for-review` → `agent:needs-work`.
- Escalation to `agent:stuck` if `review_rounds N` is at least `$max_review_rounds` or the PR is a fork.
- Lease released.

## Process

1. **Claim.** `claim N pr agent:in-progress Reviewing "$lease_ttl_pr"`. If `failures N Reviewing` is at least `$max_item_failures`, follow `references/escalate.md` and stop. Release on every exit path from here on: merged, sent back, escalated or failed.
2. **Pin the head.** `SHA=$(gh pr view N --json headRefOid --jq .headRefOid)`. Everything below applies to this commit and no other.
3. **Fork check.** If `isCrossRepository` is true, follow `references/escalate.md` and stop.
4. **Confirm the state is true.** If checks are not all green, or `ready_sha N` is not equal to `$SHA` (someone pushed after the handoff), the PR is not ready. Swap `agent:ready-for-review` for `agent:needs-work`, release, and stop for this PR. `shepherd-github-pr` will re-verify.
5. **Review.** Read the PR title, body, comments and the linked issue. Call the Skill tool twice, for `merge-safety` and for `code-review`, both against `$SHA`.
6. **Decide.**
   - **Mergeable.** Merge pinned to the reviewed commit: `gh pr merge N --match-head-commit "$SHA" --"$merge_method"`. If your tools cannot pin a merge to a commit, re-read the head SHA immediately before merging and stop if it is not `$SHA`. If the merge fails, do not retry. When someone pushed meanwhile, that is all: the next run sees the new head. For any other reason, run `fail_item N pr Reviewing "merge failed: <reason>"`, release and return `#N failed: <reason>`. After a successful merge, post the "merged" note (`references/handoff.md`), ending with `<!-- agent:handoff kind=merged sha=$SHA -->`. Then, for each issue `M` printed by `issue_for_pr N`: `gh issue edit M --remove-label agent:pr-open` and `gh issue close M --comment "Implemented in #N."`. GitHub only closes the issue itself from `Closes #M` when the PR merges into the repository's default branch, which may not be `$pr_base_branch`. Close it explicitly anyway: it does no harm if already closed, and it covers a PR whose body lacked the keyword. Done.
   - **Not mergeable.** Continue to step 7.
7. **Not mergeable: fix what is small, record the rest.**
   1. If `review_rounds N` is at least `$max_review_rounds`, follow `references/escalate.md` and stop. Do not start another round.
   2. Fix only findings that need **no design decision** and touch code this PR already changes. Check out the PR branch, run the narrowest relevant test first, push. **Never edit tests, snapshots or allowlists to get green.** Flag them instead.
   3. Post the "review" handoff, as `references/handoff.md` describes: each finding, whether you fixed it, and what remains. End the comment with `<!-- agent:handoff kind=review sha=$SHA open=<number of findings still unfixed> -->`.
   4. In one command: `gh pr edit N --remove-label agent:ready-for-review --add-label agent:needs-work`. This applies whether or not you pushed. After any push, checks must run again before the PR can be reviewed again.
8. **Release.** `release N pr agent:in-progress`.

## Result

Return one line: `#N merged`, `#N sent back: <open findings>`, `#N escalated: <reason>`, `#N skipped: <reason>` or `#N failed: <reason>`.

## Never

- Merge in the same run in which you pushed a commit. A fresh review run must review the new head.
- Merge anything other than the pinned `$SHA`.
- Retry a failed merge in the same run.
- Merge a fork PR, a draft, or a PR labelled `agent:stuck`.
