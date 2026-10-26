---
"github-agent-workflow": minor
---

Add the `retrospective` utility skill. It reads the `agent:log` run-log issues and reports ranked, evidence-backed suggestions for improving skills and process. It is read-only. Its runner filter is the input `only_runner`, so it does not collide with the shared `runner` input.
