# 0007. Serialize merges when the base branch must be up to date

## Status

Accepted

## Context

A repository can require a PR branch to be up to date with its base before it merges (GitHub's "require branches to be up to date", `strict_required_status_checks_policy`). Then a merge into the base leaves every other open PR behind, and a merge pinned to a head SHA fails for each of them.

The pipeline made that worse. Shepherding handed off every green PR, so several PRs sat at `agent:ready-for-review` at once. Reviewing merged the first and sent the rest back as "not mergeable", each time with a `kind=review` handoff. Those handoffs count as review rounds, so PRs used up `max_review_rounds` on a race they could not win. A branch update also pushes a commit, which invalidates `ready_sha`, so each loss cost a whole Shepherding, CI and Reviewing cycle, and every merge restarted the cycle for all the others. In one repository seven green PRs waited more than a day while merges did happen, one at a time, only when a review ran within minutes of a handoff.

A GitHub merge queue would serialize this, but it is only offered for organization-owned repositories, and a package user may run on a personal account.

## Decision

Serialize at the handoff, with three rules.

1. **One PR in the merge lane.** At most one PR carries `agent:ready-for-review`. Before Shepherding updates a branch or posts a ready handoff it asks `lane_holder N`. If another open, non-draft, non-`agent:stuck` PR holds the label and its ready handoff is younger than `ready_lane_ttl` (default `2 hours`), Shepherding skips the PR and leaves it at `agent:needs-work`. The TTL keeps a holder that nobody reviews from blocking the rest.
2. **Update before the handoff.** Shepherding brings a `BEHIND` branch up to date (marker `agent:branch-update`, not an attempt) and lets CI run. A later run hands it off. A conflict is a fix and counts as an attempt.
3. **A moved base is not a finding.** If Reviewing finds the branch `BEHIND` or `DIRTY` after the handoff, it does not review. It posts an `agent:deferred` comment and returns the PR to `agent:needs-work`. The marker is deliberately not an `agent:handoff`, so `review_rounds` and `shepherd_attempts` do not move.

## Consequences

- Throughput is one merge per Shepherding, CI and Reviewing cycle. With CI of a few minutes and runs every few minutes to half an hour, that is well above a handful of PRs a day. A repository that needs more should use a merge queue.
- The lane is advisory, not a lock. Two PRs can both update at once when the lane is free. The first to reach green takes it, and the other updates again after the merge. That wastes a CI run and never loops, because the loser competes only with new arrivals.
- A holder whose handoff outlives `ready_lane_ttl` stops blocking, so two PRs can be ready together after a stall. Reviewing merges the oldest, defers the other, and the race is back to one wasted cycle.
- A deferral has no cap. It happens only when something else merged, which is progress.
- Repositories without the up-to-date rule see one change: ready PRs are handed off one at a time. Set `ready_lane_ttl` very small to turn the lane off.
