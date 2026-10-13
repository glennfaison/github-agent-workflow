# Run log

Every run writes one comment to a shared log. Exploring reads the log to find recurring problems.

## Where

One GitHub issue covering roughly the last **two weeks**, titled `Agent log YYYY-MM-DD` (start date) and labelled `agent:log`. Each run appends **one comment**. `log_issue` finds the current open log issue or creates a new one when the previous one falls outside the lookback window. Every step ignores `agent:log` issues.

## What to write

```markdown
**Step:** Grooming  **Run:** 20261009T033000Z-1234  **Runner:** grok
**Outcome:** 4 groomed (3 ready-for-agent, 1 needs-info), 1 skipped (leased), 0 failed
**Items:** #31 ready-for-agent, #33 needs-info, #35 duplicate of #12, #40 ready-for-agent, #41 skipped
**Problems:** failed: #44 could not read ADR link (404); degraded: no shell
**Automation suggestions:** (optional)
```

Rules:

- Always write an entry, even when nothing was eligible.
- Under **Problems**, tag with `failed`, `escalated`, `flaky`, `degraded`, `repo-state`, or `security`.
- Exploring also writes **Deferred candidates** (at most 20).

## Reading

`read_logs DAYS` prints every entry from the last DAYS days across recent log issues, except idle ones.
