# Escalate

Use when an agent should stop and hand an item to a human. Any step can call this.

## When

- A PR comes from a fork. (An agent cannot push to it.) Escalate immediately.
- `shepherd_attempts N` has reached `MAX_SHEPHERD_ATTEMPTS`.
- `review_rounds N` has reached `MAX_REVIEW_ROUNDS` and the PR still is not mergeable.
- `failures N STEP` has reached `MAX_ITEM_FAILURES`: the same step keeps failing on this item.
- The step hits a blocker it cannot resolve itself (missing access, contradictory requirements, a change that needs a design decision).

## Do

1. Post one comment on the PR (or issue) with: the blocker in one or two sentences, what was tried (for a repeated failure, the reasons from the `agent:failure` comments), the counts that led here (`shepherd_attempts`, `review_rounds` or `failures`), and what a human needs to decide or do. End it with `<!-- agent:escalate step=<Step> -->`.
2. In one command, remove the item's state label (if it has one) and add `agent:stuck`. For a PR, if `HUMAN_REVIEWER` is set, request review from them: `gh pr edit N --add-reviewer "$HUMAN_REVIEWER"`.
3. For a PR with a linked issue, also post a one-line comment on the issue pointing at the PR.
4. Release your lease (`release N issue|pr LABEL`).
5. Log it (see `log.md`), as a `escalated` problem. Stop work on this item.

`agent:stuck` makes every step ignore the item. Only a human removes it. The marker restarts the failure count, so an item a human has fixed and unstuck is tried afresh.
