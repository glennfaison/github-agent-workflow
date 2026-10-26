# Hand a PR to a person to merge

Use when an agent reviewed a PR and should not merge it itself, but the PR is not broken: a person should read it, and merge it if they agree. Only Reviewing calls this. It is not an escalation. `escalate.md` is for an item an agent could not make progress on.

## When

- **`review-rounds`.** `review_rounds N` has reached `max_review_rounds` and the PR still is not mergeable. Open findings remain, or `merge-safety` or `code-review` still will not pass.
- **`protected-paths`.** `merge-safety`, `code-review` and the PR-format check all passed, but the PR changes a file that matches `human_merge_paths`. The agent has done its review and a person decides.

A fork PR is not this: follow `escalate.md`.

## Do

1. **Find the owners.** `OWNERS=$(codeowners_for N)`. It reads CODEOWNERS from the PR's base branch and prints the owners of the changed files, one per line, or nothing if there is no file or no owner. Add `human_reviewer` if it is set. If `codeowners_for` fails, carry on with `human_reviewer` alone and note it under **Problems** as `degraded`.
2. **Post one comment** on the PR. @mention the owners first. Then, in this order and plainly:
   - why an agent is not merging it, in one sentence: the matching files for `protected-paths`, or the rounds used and what is still open for `review-rounds`;
   - what the agent checked at `$SHA`: whether checks are green, the `merge-safety` verdict, the `code-review` result;
   - for `review-rounds`, each finding that is still open. Do not write "safe to merge" when `merge-safety` said BLOCK or HOLD: say what it said;
   - what to do: review it, and merge it if you agree; update the branch first if it is behind its base; to send it back to the agents, push your fixes or leave comments, remove `agent:human-merge` and add `agent:needs-work`, which restarts the review-round count.

   End it with `<!-- agent:human-merge reason=<review-rounds|protected-paths> sha=$SHA -->`.
3. **Relabel**, in one command: remove the PR's state label (`agent:ready-for-review`, or `agent:needs-work` if it has that) and add `agent:human-merge`.
4. **Ask for review** from the owners and `human_reviewer`, leaving out the PR's author and any email address: `gh pr edit N --add-reviewer \"<user>,<org/team>\"`. This is best effort. A person without access cannot be requested, and the @mention has already notified them. Note a failure under **Problems** as `degraded` and carry on.
5. For a PR with a linked issue, post a one-line comment on the issue: `PR #N is waiting for a person to review and merge it.` Leave `agent:pr-open` as it is.
6. **Release your lease** (`release N pr agent:in-progress`).
7. **Log it** (`log.md`) with the result `#N handed to a human: <reason>`. Add a **Problems** entry tagged `escalated` only for `review-rounds`. `protected-paths` is the policy working, not a problem.

`agent:human-merge` makes Shepherding and Reviewing ignore the PR. It holds no merge lane. Only a person removes it. The marker restarts `review_rounds`, `shepherd_attempts` and `failures`, so a PR a person has taken over and handed back is tried afresh.

## Never

- Merge the PR, approve it, or dismiss anyone's review.
- Call it "safe" or "ready to merge" beyond what `merge-safety` and `code-review` actually reported.
- Read CODEOWNERS from the PR's head.
