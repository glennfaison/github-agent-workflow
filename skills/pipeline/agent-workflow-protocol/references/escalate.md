# Escalate

Use when an agent should stop and hand an item to a human. Any step can call this.

## When

- A PR comes from a fork. (An agent cannot push to it.) Escalate immediately.
- `shepherd_attempts N` has reached `MAX_SHEPHERD_ATTEMPTS`.
- `review_rounds N` has reached `MAX_REVIEW_ROUNDS` and the PR still is not mergeable.
- The step hits a blocker it cannot resolve itself (missing access, contradictory requirements, a change that needs a design decision).

## Do

1. Post one comment on the PR (or issue) with: the blocker in one or two sentences, what was tried, and what a human needs to decide or do.
2. In one command, remove the item's state label and add `agent:stuck`. For a PR, if `HUMAN_REVIEWER` is set, request review from them: `gh pr edit N --add-reviewer "$HUMAN_REVIEWER"`.
3. For a PR with a linked issue, also post a one-line comment on the issue pointing at the PR.
4. Release your lease (`release N issue|pr LABEL`).
5. Log it (see `log.md`). Stop work on this item.

`agent:stuck` makes every step ignore the item. Only a human removes it.
