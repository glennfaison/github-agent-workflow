---
"github-agent-workflow": minor
---

The contract format now covers utility and reference skills (ADR 0013). `kind: utility` has an optional `step`, a `used_by` that lists the skills that call it, and a `returns` that describes a document (named sections, an allowed set of verdicts) rather than `#N` lines. `kind: reference` carries no other key, so `pipeline-guide`, `agent-workflow-protocol` and `runner-prompts` are exempt on the record. An empty `effects.writes` means a skill is pure, and `npm run validate` now prints a purity class (`pure`, `claimed`, `writes elsewhere`) for every contract. Every skill a contracted skill calls must have a contract, and a utility skill's `used_by` must list its callers. `CONTRACT_PENDING` names the five skills that have no contract yet (`unattended-triage`, `grill-via-github-comments`, `merge-safety`, `retrospective`, `setup-github-agent-workflow`); each follow-up removes its own name. No skill behaviour changes.
