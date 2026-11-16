---
"github-agent-workflow": patch
---
`npm run validate` now checks four rules it let through: the contract is the first section of every skill, reference skills included; a reference skill may not keep a `## Never`, `## Result` or other folded section; every skill that runs has a `## Process` section; and every pipeline skill lists `runner` and `unattended`. The protocol's **Contracts** section now defines `types` and states these rules. A heading inside a code fence no longer counts as a section.
