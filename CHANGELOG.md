# github-agent-workflow

## 1.0.1

### Patch Changes

- 8465ba2: `docs/RUNNERS.md` gains a "Copy-paste prompts" section: one ready prompt per scheduled step, listing every input that step's skills take with the default as the value, so a scheduler can paste a block and edit only what it cares about. The prompts enumerate what the skills' **Inputs** sections and the protocol's **Defaults** table say, which stay canonical.

## 1.0.0

### Major Changes

- 8c8b2f4: Skills take their inputs as key-value pairs or free text, and there is no config file.

  Every skill now has an `## Inputs` section naming what it accepts, in two interchangeable forms: `key=value` pairs and free text. It also names the skill's implicit dependencies (tools, skills, repository state) and states the **default** for each value where one is sensible.

  The shared config file is gone: `config.defaults.env` has been deleted, and with it the per-repository `.agents/docs/github-agent-workflow.env` override file. Batch sizes, lease TTLs, escalation limits, the PR base branch, merge method, build command and repository guidance are now inputs with defaults, collected in the **Defaults** table in `agent-workflow-protocol` and implemented by `scripts/lib.sh`. Override one per run with a key-value pair (`pr_base_branch=develop`) or by exporting it before sourcing the library (`AGENT_OVERRIDES` points at a file of pairs). `scripts/lib.sh` exports every default in both the documented lowercase and the historical uppercase name, so a runner's existing `PR_BASE_BRANCH` still works.

  `/setup-github-agent-workflow` no longer writes a settings file: it creates the labels and records the repository's values in its agent instructions, so the scheduler prompt can pass them. The validator checks the Inputs sections, the Defaults table and the shell library stay in step instead of checking against a config file.

  This is a breaking change: no compatibility shim remains.

### Patch Changes

- cbec32a: `pipeline-guide` links a rendered lifecycle diagram: `references/lifecycle.svg`, beside the plain-text diagram in the "Lifecycle at a glance" section. The plain-text version is unchanged and remains the in-context copy; the diagram adds no transitions of its own, and the labels reference in `agent-workflow-protocol` stays the source of truth.

## 0.2.0

### Minor Changes

- d52d0a7: Repeated failures on one item are now capped. A failed run leaves a `fail_item` comment, and after `MAX_ITEM_FAILURES` (default 3) the step escalates the item to `agent:stuck` instead of retrying it forever and filling every batch (see ADR 0003).

  Issues are filed and checked per category. `issue-format.md` now has Required sections for bugs (steps or trace, severity), features, refactors (a behaviour guard) and debt (cost), a title pattern for each, and Impact and Confidence on every issue. `file-github-issue` drops a finding that lacks a Required section, and never files a possible vulnerability. Agent briefs and `implement-github-issue` follow the category (a failing test first for a bug, unchanged tests for a refactor).

  Handoffs and logs: Reviewing posts a "merged" note with the `merge-safety` verdict after it merges. Handoffs open with a one-line summary. Escalations carry their counts and failure reasons. Run-log problems get a tag (`failed`, `escalated`, `flaky`, `degraded`, `repo-state`, `security`), and `read_logs` leaves out idle entries.

  Less repetition: how an item skill takes its input, the eligibility check, logging a result and shell setup now live once in `agent-workflow-protocol`. The validator also checks that every `$KEY` a skill names exists in `config.defaults.env`.

- a62d1bd: Add `docs/RUNNERS.md` (what a scheduler needs, prompts for runners that cannot load skills, a starting cadence). Add `APP_URL` to the config: Exploring uses it when the prompt gives no URL, and explores the code only when there is none, instead of stopping. `implement-github-issue` and `review-github-pr` now use `$PR_BASE_BRANCH` instead of naming `develop` or `main`, `issue-format.md` no longer lists one product's areas, and the docs name Python 3, not GNU `date`, as the date requirement. `pipeline-guide` gains a lifecycle diagram. The validator rejects hard-coded branch names in skills.

### Patch Changes

- 5de3896: The workflow config contract, setup skill, validator and tests now use
  `.agents/docs/github-agent-workflow.env`. `merge-safety` evaluates compatibility only
  when it is explicitly requested.
