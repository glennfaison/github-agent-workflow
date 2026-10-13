---
name: explore-github-repo
description: Explore a repository's live app and its codebase, rank what you find, and file the most valuable findings as unlabelled GitHub issues through file-github-issues. Use when asked to explore the repo or app, hunt for bugs, rough edges or missing features, or run the Exploring step of the GitHub workflow. Read-only on the app and the code.
---

# Explore GitHub repo

Explore the live app and the code, rank findings, and file the best as issues through `file-github-issues`.

## Inputs

**Free text.** Repository URL or `owner/repo`. Optional live app URL if not passed as a key-value pair.

**Key-value pairs.**

| Input | Default | What it does |
|---|---|---|
| `app_url` | *(none)* | Live app to browse |
| `issues_per_run` | `5` (or `3` when open backlog is large) | Max new issues to file in one run |
| `log_lookback_days` | `14` | How far back to read the run log |
| `dry_run` | `false` | When true, produce the ranked list + log entry but do not file |
| `runner` | `unknown` | Name recorded in the run log |

**Implicit dependencies.** `agent-workflow-protocol` (log format, degraded/no-shell path), `file-github-issues`, GitHub issue read/write, and optionally a browser for the live app.

## Process

1. **Read recent Exploring log entries** (`log_lookback_days`). Note recurring problems and deferred items.
2. **Sample the backlog.** If open issues are already dense in an area, prefer commenting over near-duplicate filings. Default `issues_per_run` to 3 when the open backlog is large.
3. **Explore the live app** when `app_url` is set. Must-probe for a page-builder style app: empty state, add component, templates, command palette, mode switch, undo/redo appearance, mobile viewport, dark mode, export. Capture 1–2 annotated screenshots only for top filing candidates. If the live app is slow or flaky, switch to code-only and record that under **Problems**.
4. **Explore the code** for matching rough edges, missing coverage, and debt.
5. **Rank** by impact × confidence. Cap deferred list at 20 with one-line scores.
6. **File (or dry-run).** Hand candidates from the top to `file-github-issues` (batch preferred). Count only `filed #N` toward the cap.
7. **Log.** One comment on the current log issue. Include filed, commented, dropped, and **Deferred candidates** (at most 20, each with a one-line impact × confidence score).

## Log format (minimum)

Start with the required YAML header from `agent-workflow-protocol/references/log.md`, then prose:

```markdown
```yaml
step: Exploring
run: <RUN_ID>
runner: <name>
outcome: "<N> filed, <M> commented, <K> dropped"
problems_count: <n>
```
**Step:** Exploring  **Run:** <RUN_ID>  **Runner:** <name>
**Outcome:** <N> filed, <M> commented, <K> dropped
**Items:** #N title…, duplicate of #X, dropped: reason…
**Deferred candidates:**
- [impact×confidence] title (why deferred)
**Problems:** degraded: … / failed: …
**Automation suggestions:** …
```

Non-empty **Problems** are also copied to the step difficulty issue (`agent:difficulty`) by `log_run`. Log issues cover roughly the last **two weeks**.

## Success criteria

A good run, even with zero filings:

- Clear log entry with YAML header, outcome, and deferred list
- High-severity regressions or data-loss risks were either filed or explicitly deferred with reason
- Live-app vs code-only decision is recorded
- No labels applied, no destructive actions

## Never

- Apply, remove or change any label
- File more than `$issues_per_run` issues
- Comment on, close or edit an issue other than the evidence comments `file-github-issues` adds
- Ask the user questions when running unattended / "no human is present"
