---
"github-agent-workflow": minor
---

Add a third Reviewing outcome, handed to a person (ADR 0008). A PR that runs out of `max_review_rounds` no longer goes to `agent:stuck`: it gets the new label `agent:human-merge` and a comment that @mentions its CODEOWNERS (read from the base branch) and says what is still open. The new input `human_merge_paths` (gitignore-style patterns, empty by default) names files an agent must never merge: once such a PR passes review it is handed to a person the same way. `agent:human-merge` is ignored by Shepherding and Reviewing, holds no merge lane, and restarts `review_rounds`, `shepherd_attempts` and `failures`. Triaging's housekeeping now also removes `agent:pr-open` when it closes an issue whose PR was merged. Run the label setup in `references/labels.md` again to create `agent:human-merge`.
