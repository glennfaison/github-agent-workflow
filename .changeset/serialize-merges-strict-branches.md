---
"github-agent-workflow": minor
---

Make the pipeline work with a base branch that must be up to date before a merge. Shepherding now hands PRs off one at a time through a merge lane (`lane_holder`, new input `ready_lane_ttl`, default `2 hours`) and updates a behind branch before the handoff. Reviewing defers a PR whose base moved after the handoff, with an `agent:deferred` comment, instead of sending it back with a review handoff, so it no longer uses up `max_review_rounds`. See ADR 0007.
