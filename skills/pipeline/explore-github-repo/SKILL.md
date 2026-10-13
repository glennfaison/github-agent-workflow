---
name: explore-github-repo
description: Explore a repository's live app and its codebase, rank what you find, and file the most valuable findings as unlabelled GitHub issues through file-github-issues. Use when asked to explore the repo or app, hunt for bugs, rough edges or missing features, or run the Exploring step of the GitHub workflow. Read-only on the app and the code.
---

# Explore GitHub repo

Explore the live app and the codebase, then file the most valuable findings as issues. This skill applies **no labels**: `triage-github-issues` picks up unlabelled issues.

**Minimum to run:** the rules in this file are enough for a normal Exploring pass. Call the Skill tool with `agent-workflow-protocol` only when you need leases, markers, escalation, or the full shared defaults.

## Inputs

**Free text.** Any prose. The first URL you find is the live app to explore; with no URL, explore the code only and say so in the log. Never ask for a URL.

**Key-value pairs.** `key=value` on a line of its own. Overrides the default for the same name.

| Input | Default | What it does |
|---|---|---|
| `app_url` | *(none)* | Live app to browse when free text gives no URL. Empty = code only |
| `issues_per_run` | `5` (or `3` when open backlog is large) | Max new issues to file in one run |
| `log_lookback_days` | `14` | How far back to read the run log |
| `dry_run` | `false` | When true, produce the ranked list + log entry but do not file |

**Implicit dependencies.** Run log, GitHub issues, and (when available) shell helpers from `agent-workflow-protocol`. Without a shell, use GitHub MCP/connector tools and browser tools; record any degradation in the log.

## Sources

- Run log (last `$log_lookback_days` days): deferred candidates, recurring problems, automation suggestions.
- Live app at the URL / `$app_url` (read-only; test data only).
- Codebase (read-only).

This skill does **not** select by label, claim work, or take a lease.

## Process

1. **Read the log.** Pull recent Exploring entries. Promote deferred candidates, recurring failures/escalations/flakes, and automation suggestions into the candidate list.
2. **Explore the live app** (skip and note if no URL or browsing fails).
   - **Must-probe surfaces** (adapt to the product): empty state, add/create primary object, templates or starters, command palette / search, mode switches (edit/preview), undo/redo appearance, mobile viewport, dark mode, export/share.
   - Capture 1–2 screenshots only for candidates you actually intend to file.
   - Code-only exploration is allowed when the live app is slow or flaky; say so in the log.
3. **Explore the codebase.** Architecture problems, technical debt, missing functionality, obvious gaps relative to the live app.
4. **Build the candidate list (uncapped).** For each:
   - title, category (`bugfix` | `feature` | `refactor` | `debt`), area, impact, confidence
   - evidence that satisfies the category's required sections
   - for **feature**: write the use case first (who, what they are trying to do, why it falls short). No use case → drop or reword as a log question
   - a short “Why this is not already covered by #X, #Y” note when related issues exist
5. **Rank.** Severity × confidence first (user-facing breakage / data loss with reproduction beats guesses). Break ties by value per effort.
6. **File (or dry-run).** Hand candidates from the top to `file-github-issues` (batch preferred). Count only `filed #N` toward the cap. Duplicates and drops do not count. Stop at `$issues_per_run` or when the list is exhausted.
   - Prefer commenting new evidence on an existing high-severity open issue over filing a near-duplicate when the backlog in that area is already dense.
7. **Log.** One comment on the current log issue. Include filed, commented, dropped, and **Deferred candidates** (at most 20, each with a one-line impact × confidence score).

## Log format (minimum)

```markdown
**Step:** Exploring  **Run:** <RUN_ID>  **Runner:** <name>
**Outcome:** <N> filed, <M> commented, <K> dropped
**Items:** #N title…, duplicate of #X, dropped: reason…
**Deferred candidates:**
- [impact×confidence] title (why deferred)
**Problems:** degraded: … / failed: …
**Automation suggestions:** …
```

Prefer a machine-readable YAML or JSON block at the top of the comment when the runner can produce it. Log issues should cover roughly the last **two weeks** (not a full month); create a new log issue when the current one ages out of the lookback window.

## Success criteria

A good run, even with zero filings:

- Clear log entry with outcome and deferred list
- High-severity regressions or data-loss risks were either filed or explicitly deferred with reason
- Live-app vs code-only decision is recorded
- No labels applied, no destructive actions

## Never

- Apply, remove or change any label
- File more than `$issues_per_run` issues
- Comment on, close or edit an issue other than the evidence comments `file-github-issues` adds
- Ask the user questions when running unattended / “no human is present”
