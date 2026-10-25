# Run log

Every run writes one comment to a shared log. The entry says what the run did, what made it hard, and what should change, so a human or the Explorer can read one place. There is **no separate difficulty issue**.

## Where

One GitHub issue labelled `agent:log`, titled `Agent log YYYY-MM-DD` (the day its window starts). Each run appends **one comment** to it. Steps ignore `agent:log` issues when selecting work, and never label, lease, triage or comment on one except to add a run-log entry.

**Window.** The issue is appended to for `log_window_days` (default **14**, two weeks). After that the next run starts a new log issue. A repository that wants a different duration sets `log_window_days=N` (whole days) in the prompt of every step. An issue keeps the window it was created with.

**Which issue.** The current log issue is the lowest-numbered **open** `agent:log` issue whose window has not ended. "Ended" means the time on the issue's own `Rotates after` line, or, for an older issue without one, its creation time plus `log_window_days`. `log_issue` does this in `scripts/helpers.mjs` (`currentLogIssue`); a runner without a shell uses the same function.

- Look the issue up with a plain list of open issues by label (`gh issue list --label agent:log --state open`, or `list_issues` with `labels: ["agent:log"]`). **Never use search** (`search_issues`, `gh search`): it is an approximate index and does not show an issue made a minute ago, which makes every run open a new one.
- Create a new issue only when that list has no issue inside its window. If two runs created one at the same moment, the lowest number is the log; the other run closes its own as a duplicate and appends to the lowest.
- Do not pass anything but one expression to `gh --jq`. It has no `--arg`.

This is deliberately not a file in the repository. A committed log would need a commit per run. Issue comments are append-only, timestamped, and need no PR.

### When it was last written

The issue body always says when the log was last modified:

```markdown
- **Started:** 2026-10-16T04:25:01Z
- **Rotates after:** 2026-10-30T04:25:01Z
- **Last entry:** 2026-10-17T18:33:40Z (Triaging, run 20261017T183209Z-kilo)
```

`log_run` rewrites the issue body after each entry so `Last entry` is current. `log_status` prints `issue=`, `started=`, `rotates_after=` and `last_entry=` without creating anything. Every entry also carries its own `at:` time in the header. The issue's `updatedAt` is a fallback only: a label change moves it too.

### Legacy `agent:difficulty` issues

Earlier versions kept one `Agent difficulties: <Step>` issue per step. They are no longer created or written to. Every step still ignores any that exist, so they can be closed by a human at leisure; their contents are not needed.

## Machine-readable header

Every log comment **starts** with a fenced YAML block so runners can filter by step, runner, or date without parsing prose:

````markdown
```yaml
step: Exploring
run: 20261009T033000Z-1234
runner: grok
at: 2026-10-09T03:41:12Z
outcome: "2 filed, 1 commented, 0 failed"
problems_count: 1
```
````

| Key | Required | Meaning |
|---|---|---|
| `step` | yes | Exploring, Triaging, Implementing, Shepherding, Reviewing |
| `run` | yes | `RUN_ID` |
| `runner` | yes | Runner name (from the `runner` input; default `unknown`). Required so log and issue comments can be attributed |
| `at` | yes | When the entry was written, UTC ISO-8601 (`log_run` adds it if missing) |
| `outcome` | yes | Short summary string (same facts as **Outcome:**) |
| `problems_count` | yes | Number of tagged problem lines (0 if none) |

## What to write after the header

```markdown
**Step:** Exploring  **Run:** 20261009T033000Z-1234  **Runner:** grok
**Outcome:** 2 filed, 1 commented, 3 dropped as duplicates
**Items:** filed #401, #402; commented #388
**Problems:** degraded: live app timed out; repo-state: no shell helpers
**Things to improve:** the live app needs a longer timeout; scripting the dedupe pass would save a step
**Deferred candidates:** (Exploring only, at most 20)
- title — impact×confidence one-liner
```

Rules:

- Always write an entry, even when nothing was eligible. An idle entry is the YAML header plus `**Outcome:** nothing eligible` and `problems_count: 0`; leave out the other fields. `read_logs` leaves idle entries out.
- Every other entry has **both** **Problems** and **Things to improve**. Write `none` for one that is empty; that is a statement, and it is not copied anywhere.
- **Problems** are the run's difficulties. Start each with a tag: `failed`, `escalated`, `flaky`, `degraded`, `repo-state`, or `security`.
- **Things to improve** are changes that would make the next run easier: a fix to a skill, a missing tool or permission, a repeated deterministic step worth scripting, a repo problem. Only suggest; never implement unprompted. (Older entries call this **Automation suggestions**; readers accept both.)
- Cap **Deferred candidates** at 20. Each line needs a one-line **impact × confidence** score.
- A group skill writes one entry per run covering all items it dispatched. An item skill run on its own writes an entry for its one item.
- **One entry per run and step.** `log_run` skips an entry whose `run` and `step` are already on the log issue, so a retry is safe. A runner with no shell checks the issue's comments (`hasLogEntry`) first.
- Write real line breaks, never the two characters backslash and `n`. `log_run` repairs an entry written that way, but do not rely on it.
- Write the entry to a temp file, then run `log_run FILE` (shell) or post the same body with GitHub tools (no-shell). Use `formatLogComment` from `scripts/helpers.mjs` so the header and field order stay identical across runners.
- The prose header line must include `**Runner:**` with the same value as the YAML `runner` key. Agent comments on issues and PRs (outside the log) follow the same rule; see `references/handoff.md`.

## Reading

`read_logs DAYS` prints every entry from the last DAYS days across the most recent log issues, except idle ones. An entry with `Problems: none` and `Things to improve: none` that only says "nothing eligible" is idle. Prefer filtering on the YAML header (`step:`, `runner:`, `run:`, `at:`) when present; fall back to the prose `**Step:**` line for older comments.
