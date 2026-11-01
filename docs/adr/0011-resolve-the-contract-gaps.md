# 0011. Resolve the gaps the contracts exposed

## Status

Accepted

## Context

Writing a contract for each pipeline skill (ADR 0010) showed where a skill's behaviour was hard to state as a function. ADR 0010 listed ten gaps and left them alone so the contracts could describe today's behaviour first. This ADR records how each was resolved.

## Decisions

| # | Gap | Resolution |
|---|---|---|
| 1 | An item skill's own run-log entry depended on whether it was dispatched, which a sub-agent could not tell. It also lost every other input of the group run | New input `write_log` (default `true`). Dispatching passes the URL, `write_log=false`, and every group input the item also lists in `params`. The validator checks a dispatched item that logs accepts `write_log` |
| 2 | `skipped` meant both "nothing happened" and "claimed, then gave up". `review-github-pr` step 4 had no result line | `skipped`: nothing claimed, nothing written. New `noop`: claimed, found nothing to do, released. New `#N not ready: <reason>` for review step 4 |
| 3 | `file-github-issues` mentioned a limit with no input | New input `limit`. Past it, candidates return `deferred: over limit` unchecked. `explore-github-repo` passes `limit=explore_batch` |
| 4 | `explore_batch` defaulted to 3 or 5 depending on an undefined "large" backlog | Always `5` |
| 5 | Eligibility called `clear_stale_lease`, which writes | Eligibility only reads. A stale label does not count as a lease and the next `claim` replaces it. The validator rejects a `requires` that names a writing helper |
| 6 | `triage-github-issues` changed issues it had not claimed | New skill `reconcile-github-issues` (`kind: sweep`). It lists what it may change, takes `dry_run`, and also clears stale lease labels. `triage-github-issues` calls it |
| 7 | "Close the issue after a merge unless keep-open" was written in three places, "abandoned PR" in two | `references/issue-after-pr.md` holds the rule. Callers state only what they add. The label repair priority is read from `labels.md` instead of copied |
| 8 | `triage-github-issue` reconciled a prior outcome after the costly decision | Moved to step 4, before the format check and the decision |
| 9 | Two suspected bugs: a conflicted PR often runs no checks and was skipped as `no-checks-yet`, and a PR waiting on the merge lane collected a lease comment on every run | A `DIRTY` branch is eligible whatever its checks say. Eligibility reads the lane and merge state before claiming, so a PR that can only wait is skipped without a claim. A lane taken after the claim returns `noop` |
| 10 | `lease_live` ignores who holds the lease, so a nested call would skip its own caller's item | New input `lease_held` (default `false`). When `true`, `claim` and `release` do nothing and the lease must be live |

## Consequences

- Behaviour changes for anyone running these skills: three new inputs (`write_log`, `lease_held`, `limit`), a new skill, new result lines (`noop`, `not ready`, `deferred: over limit`), and a different `explore_batch` default when the backlog was large.
- Gap 9 is a fix for a problem inferred from reading the steps, not seen in a run. A scenario test with a conflicted PR and no checks should confirm it, and the same fixture can guard against a regression.
- `lease_held` is the first piece of what a skill that calls itself needs. A skill that actually recurses also needs a depth bound, and children that cannot split again.
