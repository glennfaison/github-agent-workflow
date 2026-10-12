---
"github-agent-workflow": major
---

Skills take their inputs as key-value pairs or free text, and there is no config file.

Every skill now has an `## Inputs` section naming what it accepts, in two interchangeable forms: `key=value` pairs and free text. It also names the skill's implicit dependencies (tools, skills, repository state) and states the **default** for each value where one is sensible.

The shared config file is gone: `config.defaults.env` has been deleted, and with it the per-repository `.agents/docs/github-agent-workflow.env` override file. Batch sizes, lease TTLs, escalation limits, the PR base branch, merge method, build command and repository guidance are now inputs with defaults, collected in the **Defaults** table in `agent-workflow-protocol` and implemented by `scripts/lib.sh`. Override one per run with a key-value pair (`pr_base_branch=develop`) or by exporting it before sourcing the library (`AGENT_OVERRIDES` points at a file of pairs). `scripts/lib.sh` exports every default in both the documented lowercase and the historical uppercase name, so a runner's existing `PR_BASE_BRANCH` still works.

`/setup-github-agent-workflow` no longer writes a settings file: it creates the labels and records the repository's values in its agent instructions, so the scheduler prompt can pass them. The validator checks the Inputs sections, the Defaults table and the shell library stay in step instead of checking against a config file.

This is a breaking change: no compatibility shim remains.
