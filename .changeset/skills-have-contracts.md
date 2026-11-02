---
"github-agent-workflow": minor
---

Every pipeline skill now opens with a `## Contract`: a YAML block giving its preconditions (`requires`), the closed set of result lines it can return (`returns`), its postconditions (`ensures`), every side effect by scope (`effects`), what it must never do, the skills it calls, and why it is idempotent and terminates. The contract replaces the separate Eligibility, Context read, Outputs, Result, Never and Success criteria sections. Behaviour is unchanged, with two corrections to the documented results: `triage-github-issue` and `implement-github-issue` now list `#N escalated: <reason>`, which their steps could already produce. `npm run validate` checks every contract against its skill (new `scripts/contracts.mjs`, with tests). `file-github-issues`' Inputs table is split into two valid tables, and `AGENTS.md` now lists `runner-prompts` as a meta, user-invoked skill. See `docs/adr/0010-skills-as-functions-with-contracts.md`.
