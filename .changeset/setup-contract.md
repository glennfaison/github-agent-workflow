---
"github-agent-workflow": patch
---

`setup-github-agent-workflow` has a `## Contract` (`kind: utility`, user-invoked, `used_by: []`) and five scenarios: an empty repository gets every label, an existing `agent:` label is reset and an existing triage label is kept, a second run changes nothing, the settings go into `CLAUDE.md` when it exists, and only the `## GitHub workflow` section is updated. Every skill now has a contract, and `CONTRACT_PENDING` is empty. The skill lists its nine settings in an Inputs table, which the protocol's Defaults rows now name it as a user of, and the protocol says that `repository` writes include repository settings such as the label set. The scenario world can hold the repository's labels and files, with `label_create`, `label_update` and `write_file` effects that `diffWorlds` also produces. The label set a scenario expects is read from `references/labels.md`. See ADR 0013.
