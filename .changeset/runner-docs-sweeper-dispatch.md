---
"github-agent-workflow": patch
---

`docs/RUNNERS.md` now covers the sweeper and the newer inputs. It says when to schedule `reconcile-github-issues` (and that Triaging also runs it), what a runner that dispatches items itself must pass (the item's URL, `write_log=false` and the group's inputs), and where `write_log`, `lease_held` and `limit` are defined. The README's schedule table lists the sweeper.
