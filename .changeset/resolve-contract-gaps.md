---
"github-agent-workflow": minor
---

Fixes the ten gaps found while writing the skill contracts (ADR 0011).

New inputs: `write_log` (default `true`) on the four item skills, so a dispatched item no longer writes a second run-log entry; `lease_held` (default `false`), so a nested call can borrow its caller's lease; and `limit` on `file-github-issues`. Group skills now pass the item its URL, `write_log=false` and every group input the item also accepts, where a sub-agent used to get only the URL and lose `runner`, `unattended` and `trusted_authors`.

New results: `#N noop: <reason>` (claimed, nothing to do, released), `#N not ready: <reason>` from `review-github-pr`, and `deferred: over limit` from `file-github-issues`. `skipped` now always means nothing was claimed.

`shepherd-github-pr` now treats a conflicting branch as work whatever its checks say, and reads the merge lane and merge state before claiming, so a PR that can only wait no longer collects a lease comment on every run. Eligibility checks only read: `clear_stale_lease` is no longer part of them.

New skill `reconcile-github-issues`, which takes over the housekeeping that `triage-github-issues` did (closing issues whose PR merged, abandoned PRs, label repair) and clears stale lease labels. The rule for what an issue becomes after its PRs settle is now one reference, `references/issue-after-pr.md`. `triage-github-issue` reconciles a prior trusted outcome before it decides, not after. `explore_batch` is always `5`; it no longer drops to `3` on a "large" backlog.
