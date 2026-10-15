# Run log

Every run writes one comment to a shared log. Exploring reads the log to find recurring problems. When a run reports **Problems**, the same entry is also appended to that step's **difficulty issue**.

## Where

### Run log (`agent:log`)

One GitHub issue covering roughly the last **two weeks**, titled `Agent log YYYY-MM-DD` (start date) and labelled `agent:log`. Each run appends **one comment**. `log_issue` finds the current open log issue or creates a new one when the previous one falls outside the lookback window. Every step ignores `agent:log` issues.

This is deliberately not a file in the repository. A committed log would need a commit per run. Issue comments are append-only, timestamped, and need no PR.

### Difficulty issues (`agent:difficulty`)

One open issue per pipeline step, titled `Agent difficulties: <Step>` (for example `Agent difficulties: Exploring`) and labelled `agent:difficulty`. When a run's log entry has a non-empty **Problems** field, `log_run` also posts that entry as a comment on the step's difficulty issue. Shell helper: `difficulty_issue <Step>`.

Rotate on the same ~2 week cadence as the run log. Steps ignore `agent:difficulty` when selecting work.

## Machine-readable header

Every log comment **starts** with a fenced YAML block so runners can filter by step, runner, or date without parsing prose:

````markdown
```yaml
step: Exploring
run: 20261009T033000Z-1234
runner: grok
outcome: "2 filed, 1 commented, 0 failed"
problems_count: 1
```
````

Fields:

| Key | Required | Meaning |
|---|---|---|
| `step` | yes | Exploring, Grooming, Implementing, Shepherding, Reviewing |
| `run` | yes | `RUN_ID` |
| `runner` | yes | Runner name |
| `outcome` | yes | Short summary string (same facts as **Outcome:**) |
| `problems_count` | yes | Number of tagged problem lines (0 if none) |

## What to write after the header

Keep the human-readable fields below the YAML block. Leave out a field that has nothing in it:

```markdown
**Step:** Exploring  **Run:** 20261009T033000Z-1234  **Runner:** grok
**Outcome:** 2 filed, 1 commented, 3 dropped as duplicates
**Items:** filed #401, #402; commented #388
**Problems:** degraded: live app timed out; repo-state: no shell helpers
**Automation suggestions:** (optional) repeated step worth scripting
**Deferred candidates:** (Exploring only, at most 20)
- title — impact×confidence one-liner
```

Rules:

- Always write an entry, even when nothing was eligible. An idle entry is the YAML header plus `**Outcome:** nothing eligible` and `problems_count: 0`. `read_logs` leaves idle entries out.
- Under **Problems**, record anything a human or the Explorer should know. Start each with a tag: `failed`, `escalated`, `flaky`, `degraded`, `repo-state`, or `security`.
- Cap **Deferred candidates** at 20. Each line needs a one-line **impact × confidence** score.
- Under **Automation suggestions**, list repetitive deterministic steps worth scripting. Only suggest; never implement unprompted.
- A group skill writes one entry per run covering all items it dispatched. An item skill run on its own writes an entry for its one item.
- Write the entry to a temp file, then run `log_run FILE` (shell) or post the same body with GitHub tools (no-shell). Use `formatLogComment` from `scripts/helpers.mjs` so the YAML header and field order stay identical across runners.

## Reading

`read_logs DAYS` prints every entry from the last DAYS days across the most recent log issues, except idle ones. Prefer filtering on the YAML header (`step:`, `runner:`, `run:`) when present; fall back to the prose `**Step:**` line for older comments.
