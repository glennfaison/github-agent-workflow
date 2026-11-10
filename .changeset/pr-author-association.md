---
"github-agent-workflow": patch
---

`prs_for_issue` and `issue_for_pr` work on a real `gh`. They asked `gh pr list` and `gh pr view` for `authorAssociation`, which `gh` rejects as a PR field (`Unknown JSON field`), so neither could find the PR that belongs to an issue. Both now read the REST pull request, which has the author's association, and apply the same trust rule as before. `issue_for_pr` reads GitHub's own issue links with `gh` 2.72 or newer, and without that it still reads the description. It now prints the issue numbers in numeric order.
