---
"github-agent-workflow": patch
---

`triage-github-issue`, `implement-github-issue` and `review-github-pr` now list what they may write as `allow` entries (step 2 of ADR 0017), so the scenario checker refuses a label, a comment marker or an op that the skill's text does not permit, even where its scope allows a write. For example triage applying `wontfix`, implementing merging a PR, or review sending a linked issue back to `ready-for-agent`. The wording of the skills' contracts is unchanged.
