---
"github-agent-workflow": patch
---

`tests/lib.test.sh` now checks for `jq`, `git` and `node` first and exits with one line naming the missing tool, instead of printing dozens of `jq: command not found` errors and ending with a long list of failures. The hooks check in `npm test` now says how to install the hooks (`npm ci`) and how to skip the check (`HUSKY=0`). `AGENTS.md` lists what the checks need.
