# Cap repeated failures on one item

Status: accepted

Every step picks its items oldest first and takes at most a batch. When a run on an item fails, the item keeps its input state, so the next run picks it again, first. Shepherding and Reviewing already cap their retries (`MAX_SHEPHERD_ATTEMPTS`, `MAX_REVIEW_ROUNDS`). Grooming and Implementing did not, and neither did a merge that the branch rules refuse. An item that can never succeed (an unreadable ADR link, a refused merge) would take a batch slot on every run, and with a small batch it would starve everything behind it.

## Decision

- A failed run on a claimed item posts a comment with an `agent:failure` marker (`fail_item`).
- After claiming, a step counts the markers for its own step since the last escalation (`failures N STEP`). At `MAX_ITEM_FAILURES` it escalates through `references/escalate.md` instead of working.
- The escalation comment carries an `agent:escalate` marker, which restarts the count. A human who fixes the cause and removes `agent:stuck` gets a fresh start.

## Consequences

- A permanent failure costs `MAX_ITEM_FAILURES` runs, and then a human sees it with the reasons attached.
- A failure leaves a visible comment on the item. Before, it was only in the run log.
- Failures from before a successful run still count until an escalation. An item that fails rarely over a long life can reach the cap. That costs a human one look.
