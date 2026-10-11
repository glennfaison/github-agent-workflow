---
"github-agent-workflow": patch
---

The workflow config contract, setup skill, validator and tests now use
`.agents/docs/github-agent-workflow.env`. `merge-safety` evaluates compatibility only
when it is explicitly requested.
