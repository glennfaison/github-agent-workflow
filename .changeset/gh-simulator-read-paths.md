---
"github-agent-workflow": patch
---

A `gh` simulator for tests (`tests/sim/bin/gh`) answers `gh` calls from a world file in the scenarios' format and logs every call. This part covers the read paths: `issue list|view`, `pr list|view|checks`, `label list`, `repo view`, `auth status` and `run view`, with `--json` fields checked against the ones `gh` really has. A command, flag or field it does not cover exits with `unsupported: <what>`, and a test fails when a skill calls a `gh` command that is not in the manifest. The write paths, `api` and fault injection follow.
