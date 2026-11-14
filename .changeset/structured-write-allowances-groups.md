---
"github-agent-workflow": patch
---

The remaining contracts (the four group skills, `reconcile-github-issues`, `file-github-issues`, `explore-github-repo` and `setup-github-agent-workflow`) now list what they may write as `allow` entries, which completes ADR 0017: every contract that writes is checked by what it writes and not only by where. An `allow` for `create_issue` and `create_pr` now has a required `labels` list, so "new issues, with no labels" and "a PR labelled agent:needs-work" are checked, and `implement-github-issue` is tightened to match. The wording of the contracts is unchanged.
