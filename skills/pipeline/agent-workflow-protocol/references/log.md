# Run log

Every run writes one comment to a shared log. Exploring reads the log to find recurring problems.

## Where

One GitHub issue per month, titled `Agent log YYYY-MM` and labelled `agent:log`. Each run appends **one comment**. `log_issue` finds this month's issue or creates it. Every step ignores `agent:log` issues.

This is deliberately not a file in the repository. A committed log would need a commit per run. By your branch rules that means a gitflow branch and a PR per run, the Reviewing step would try to review those PRs, and parallel runners would collide on the same file. Issue comments are append-only, timestamped, and need no PR.

## What to write

A group skill writes one entry per run, covering all the items it dispatched. An item skill run on its own (not dispatched by a group skill) writes an entry for its one item. Write the entry to a temp file, then run `log_run FILE`. Keep it short. Use this shape:

```markdown
**Step:** Grooming  **Run:** 20261009T033000Z-1234  **Runner:** grok
**Outcome:** 4 groomed (3 ready-for-agent, 1 needs-info), 1 skipped (leased), 0 failed
**Items:** #31 ready-for-agent, #33 needs-info, #35 duplicate of #12, #40 ready-for-agent, #41 skipped
**Problems:** #44 grooming failed: could not read ADR link (404)
**Automation suggestions:** (optional) repeated step worth scripting, with a one-line proposal
```

Rules:

- Always write an entry, even when nothing was eligible (`Outcome: nothing eligible`).
- Under **Problems**, record anything a human or the Explorer should know: failures, escalations, flaky checks, surprising repo state.
- Under **Automation suggestions**, list steps in this run that were repetitive and deterministic and cost tokens. For each, propose how to automate it (script, test, hook, skill or CI check). Only suggest; never implement unprompted. This replaces any "suggest automation at the end of the task" rule in the repository guidance, for unattended runs.
- Exploring also writes **Deferred candidates**: findings that did not make the top `EXPLORE_ISSUE_CAP`, one line each, at most 20.

## Reading

`read_logs DAYS` prints every entry from the last DAYS days across the most recent three log issues. Only Exploring reads the log today.
