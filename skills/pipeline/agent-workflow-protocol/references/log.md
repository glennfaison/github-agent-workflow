# Run log

Every run writes one comment to a shared log. Exploring reads the log to find recurring problems.

## Where

One GitHub issue per month, titled `Agent log YYYY-MM` and labelled `agent:log`. Each run appends **one comment**. `log_issue` finds this month's issue or creates it. Every step ignores `agent:log` issues.

This is deliberately not a file in the repository. A committed log would need a commit per run. Under a repository's branch rules that can mean a protected branch and a PR per run, the Reviewing step would try to review those PRs, and parallel runners would collide on the same file. Issue comments are append-only, timestamped, and need no PR.

## What to write

A group skill writes one entry per run, covering all the items it dispatched. An item skill run on its own (not dispatched by a group skill) writes an entry for its one item. Write the entry to a temp file, then run `log_run FILE`. Keep it short. Use this shape, and leave out a field that has nothing in it:

```markdown
**Step:** Grooming  **Run:** 20261009T033000Z-1234  **Runner:** grok
**Outcome:** 4 groomed (3 ready-for-agent, 1 needs-info), 1 skipped (leased), 0 failed
**Items:** #31 ready-for-agent, #33 needs-info, #35 duplicate of #12, #40 ready-for-agent, #41 skipped
**Problems:** failed: #44 could not read ADR link (404); degraded: no shell, labels edited through the connector
**Automation suggestions:** (optional) repeated step worth scripting, with a one-line proposal
```

Rules:

- Always write an entry, even when nothing was eligible. An idle entry is just the header line and `**Outcome:** nothing eligible`, with no other field. `read_logs` leaves idle entries out, so they cost Exploring nothing.
- Under **Problems**, record anything a human or the Explorer should know. Start each with a tag, so recurring problems can be counted: `failed` (an item's run failed), `escalated` (an item went to `agent:stuck`), `flaky` (a check or tool that fails at random), `degraded` (you ran without something a skill expected: no shell, `tdd` or `code-review` not installed, a tool missing), `repo-state` (surprising state, for example an issue with `agent:pr-open` and no PR) or `security` (a possible vulnerability, with no exploit details).
- Under **Automation suggestions**, list steps in this run that were repetitive and deterministic and cost tokens. For each, propose how to automate it (script, test, hook, skill or CI check). Only suggest; never implement unprompted. This replaces any "suggest automation at the end of the task" rule in the repository guidance, for unattended runs.
- Exploring also writes **Deferred candidates**: findings that did not make the top `issues_per_run`, one line each, at most 20.

## Reading

`read_logs DAYS` prints every entry from the last DAYS days across the most recent three log issues, except idle ones. Only Exploring reads the log today.
