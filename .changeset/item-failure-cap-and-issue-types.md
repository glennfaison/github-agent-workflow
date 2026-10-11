---
"github-agent-workflow": minor
---

Repeated failures on one item are now capped. A failed run leaves a `fail_item` comment, and after `MAX_ITEM_FAILURES` (default 3) the step escalates the item to `agent:stuck` instead of retrying it forever and filling every batch (see ADR 0003).

Issues are filed and checked per category. `issue-format.md` now has Required sections for bugs (steps or trace, severity), features, refactors (a behaviour guard) and debt (cost), a title pattern for each, and Impact and Confidence on every issue. `file-github-issue` drops a finding that lacks a Required section, and never files a possible vulnerability. Agent briefs and `implement-github-issue` follow the category (a failing test first for a bug, unchanged tests for a refactor).

Handoffs and logs: Reviewing posts a "merged" note with the `merge-safety` verdict after it merges. Handoffs open with a one-line summary. Escalations carry their counts and failure reasons. Run-log problems get a tag (`failed`, `escalated`, `flaky`, `degraded`, `repo-state`, `security`), and `read_logs` leaves out idle entries.

Less repetition: how an item skill takes its input, the eligibility check, logging a result and shell setup now live once in `agent-workflow-protocol`. The validator also checks that every `$KEY` a skill names exists in `config.defaults.env`.
