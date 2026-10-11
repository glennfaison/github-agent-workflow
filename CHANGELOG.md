# github-agent-workflow

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
