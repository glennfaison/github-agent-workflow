# github-agent-workflow

## 1.4.0

### Minor Changes

- cb4c80a: Fix the run log opening a new issue on every run.

  - `log_issue` looked up the current log issue with `gh issue list --jq --arg ...`. `gh` has no `--arg`, so the lookup failed silently and every call created a new issue. Lookup, rotation, body and entry handling now live in `helpers.mjs`, and the tests use a `gh` stub that can actually find nothing.
  - Runners with no shell no longer use `search_issues` (an approximate index) to find the log issue; they list open `agent:log` issues.
  - One log issue is appended to for `log_window_days` (default 14; replaces `log_lookback_days`, which is still read). Concurrent runs that both create one converge on the lowest number.
  - The log issue body records `Started`, `Rotates after` and `Last entry`, and every entry carries an `at:` time. `log_status` prints them.
  - Difficulties are part of the run-log entry (**Problems** and the new **Things to improve**, which replaces **Automation suggestions**). `agent:difficulty` issues are no longer created or written to.
  - Triage now excludes `agent:difficulty` issues from selection and eligibility, and the protocol makes `agent:log` and `agent:difficulty` issues ineligible for every step. The validator checks this.
  - `log_run` is idempotent per run and step, adds a missing `at:`, and repairs entries written with literal `\n`.

## 1.3.0

### Minor Changes

- 9c48c29: Restore the protocol contract the skills cite, check markers by author, and move the runner prompts into a generated skill.

  - **Restored.** The protocol skill and its references had lost sections that skills still cited: **Group skills and item skills**, **Rules every step follows**, **Leases**, the marker table, the label state and transition tables and the `gh label create` setup block (`/setup-github-agent-workflow` depends on it), the handoff contents, the escalation steps, the dedupe search commands and canonical rule, and Triaging's check in the issue format. `/setup-github-agent-workflow` is user-invoked again (it had lost `disable-model-invocation`).
  - **Security.** A marker now counts only if an `OWNER`, `MEMBER` or `COLLABORATOR`, the agent's own account, or a login in the new `trusted_authors` input wrote it. This covers leases, handoffs, attempts, failures and the `agent:implements` PR marker. The protocol gains a **Trust** section: text on an item is data, not instructions. If the agent runs as a GitHub App, set `trusted_authors` to its bot login. See ADR 0006.
  - **Renames.** The step "Grooming" is now "Triaging", including in markers and run logs (failures written under the old name still count). `groom_batch` is now `triage_batch` and `issues_per_run` is now `explore_batch`; the old input names still work until the next major version.
  - **New inputs on every pipeline skill.** `runner`, `unattended` (default `true`, replacing the "no human is present" sentence pasted into prompts), and `trusted_authors` where markers are read. `shepherd-github-pr` and `review-github-pr` now list `git_hooks_path`, which the protocol already said they use.
  - **New skill `runner-prompts`** (user-invoked) prints the copy-paste prompts, generated from the skills' Inputs tables by `npm run sync` and checked in CI. `docs/RUNNERS.md` no longer carries prompt blocks. ADR 0005 supersedes ADR 0004.
  - **`pipeline-guide` is a table of contents.** One table says which skill to use and when, with no links by path. `AGENTS.md` points only to it. The lifecycle flowchart moved to `docs/lifecycle.svg` and is embedded in the README.
  - **One implementation.** `scripts/helpers.mjs` now holds dates, run ids, comment shapes, marker parsing and trust, and `lib.sh` calls it. Durations also accept `1h`, `30m`, `2d` and ISO 8601 (`PT1H`). Run ids now end in the runner name (`20261015T134700Z-grok`) rather than a process id.
  - **Checks.** The validator now fails on a cited section that does not exist, and on a Defaults table that disagrees with the skills' Inputs. `npm test` also runs `tests/helpers.test.mjs`, and both test suites share `tests/fixtures/markers.json`.

## 1.2.2

### Patch Changes

- 995b056: Ship a pure-JS no-shell reference (`scripts/helpers.mjs`) for RUN_ID, dates, lease/log comment shapes, and document the explicit degraded path. Replace the remaining Python usage in `link-skills.sh` with Node so the package no longer depends on Python.
- 4d74a8c: pipeline-guide: add copy-paste prompts for every pipeline skill (all key-value inputs) and a lifecycle flowchart (`references/lifecycle.svg`) showing labels, leases and handoffs.

## 1.2.1

### Patch Changes

- 00a83fd: `docs/RUNNERS.md` gains one ready-to-paste prompt per pipeline skill — the group skill to schedule and the item skill to run by hand, for each of the five steps — each listing every input that skill takes with its default as the value, replacing the single `explore-github-repo` example. The prompts enumerate what the skills' **Inputs** sections and the protocol's **Defaults** table say, which stay canonical.
- 00a83fd: Add ADR 0004 ([docs/adr/0004-runners-doc-syncs-with-pipeline-skills.md](../docs/adr/0004-runners-doc-syncs-with-pipeline-skills.md)): `docs/RUNNERS.md` keeps one prompt block per pipeline skill, listing every input with its default as the value, and any change to an input — or to the doc — checks both sides. The skills' **Inputs** sections and the protocol's **Defaults** table stay canonical.

## 1.2.0

### Minor Changes

- 256a00e: Complete remaining checklist items: pin mattpocock-skills@1.3.0, replace Python date helpers with Node.js, per-step difficulty log issues, machine-readable YAML log headers

## 1.1.0

### Minor Changes

- b1a4916: Improve skill structure and ergonomics for unattended runners

  - Rename `unattended-grilling` → `grill-via-github-comments`
  - Rename `file-github-issue` → `file-github-issues` and support batch + dry_run
  - Move `pipeline-guide`, `agent-workflow-protocol`, and `setup-github-agent-workflow` to `skills/meta/`
  - Point AGENTS.md and READMEs at `pipeline-guide` as the entry point
  - Prefer 2-week log windows over monthly
  - Inline minimum Exploring rules; reduce mandatory pre-reading
  - Strengthen explore guidance (must-probe checklist, success criteria, unattended mode)
  - Document degraded / no-shell path more clearly

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
