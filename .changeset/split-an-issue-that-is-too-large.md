---
"github-agent-workflow": minor
---

`implement-github-issue` splits an issue that is too large for one PR into linked sub-issues (`#N split into #A, #B`), bounded by the new `max_depth` input (default `1`). `file-github-issues` takes a `parent`, `reconcile-github-issues` closes the parent when its sub-issues close, and the scenario checker rejects `lease_held=true` from a skill that does not hold the lease. See ADR 0015.
