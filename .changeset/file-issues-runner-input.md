---
"github-agent-workflow": patch
---
`file-github-issues` now lists `runner` like every other pipeline skill, and the protocol's **Defaults** table names it. `explore-github-repo` passes its runner name on when it dispatches the skill, so the runner no longer falls back to `unknown`. The runner prompts are regenerated.
