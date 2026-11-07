---
"github-agent-workflow": patch
---

Scenario checks now have an eligibility oracle for every item skill: `triage-github-issue`, `implement-github-issue` and `review-github-pr` join `shepherd-github-pr`. Each mirrors its skill's `requires`, models the lease as `lease: live | stale | none` on the item, and honours `lease_held`. A test compares each skill's number of `requires` entries with the oracle's, so a changed precondition prompts a look at the oracle. A skipped item no longer has to be free of lease labels, because the label may belong to the run that holds it. Test tooling only, with no change to any skill. See `docs/adr/0012-scenarios.md`.
