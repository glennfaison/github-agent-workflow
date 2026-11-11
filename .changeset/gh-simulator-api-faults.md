---
"github-agent-workflow": patch
---

The `gh` simulator for tests is finished. `gh api` answers the REST calls the package makes (a user, an item's comments, editing a comment in place, a PR's files, repository contents and tree, the PR list and one PR, and `update-branch`), a world's `faults` make a matching call fail or let another run get in first, and `tests/lib.test.sh` now runs against the simulator instead of its own stub, so there is one mock of `gh`. The checker's effect model gains `comment_edit`, so a lease edited in place is read back by `diffWorlds`.
