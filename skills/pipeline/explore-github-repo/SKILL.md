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
| `explore_batch` | `5` (or `3` when open backlog is large) | Max new issues to file in one run |
| `log_window_days` | `14` | Days one run-log issue is appended to before a new one starts. Also how far back this step reads the log |
| `dry_run` | `false` | When true, produce the ranked list + log entry but do not file |
| `runner` | `unknown` | Name recorded in the run id and the run log |
| `unattended` | `true` | `true`: no human is present, so never ask (see **Unattended runs** in the protocol). `false`: a human may be asked |

**Implicit dependencies.** The common ones (**Shell setup** and **Running without a shell** in the protocol), plus `file-github-issues`, GitHub issue read and write, and optionally a browser for the live app.

## Process

1. **Preflight.** Confirm the skills this step needs are readable. When live UI is in scope (`app_url` is set, or the product expects interactive probes such as canvas, command palette, screenshots):
   - Check that product `node_modules` (or equivalent) and a browser binary (Playwright or similar) are present on the runner.
   - If either is missing, **do not hard-fail**. Continue in **degraded mode**: still run the cheap HTTP / route / SSR checks you can, skip interactive UI, canvas, command palette, and screenshot probes, and record under **Problems** a tagged line such as `degraded: no browser` or `degraded: no node_modules`.
   - Prefer logging over abort so unattended schedules still produce value. Do not bake a product `npm ci` (or install) into this skill; keep the package runner-agnostic. Copy-paste fix commands for a shell runner (adjust to the product):

     ```bash
     npm ci
     npx playwright install
     ```

   Skills-only or code-only Exploring needs no browser stack.

2. **Read recent Exploring log entries** (`log_window_days`). Note recurring problems and deferred items.
3. **Sample the backlog.** If open issues are already dense in an area, prefer commenting over near-duplicate filings. Default `explore_batch` to 3 when the open backlog is large.
4. **Explore the live app** when `app_url` is set and the preflight did not put the run in degraded mode. Must-probe for a page-builder style app: empty state, add component, templates, command palette, mode switch, undo/redo appearance, mobile viewport, dark mode, export. Capture 1–2 annotated screenshots only for top filing candidates. If the live app is slow or flaky, switch to code-only and record that under **Problems**. In degraded mode, limit yourself to HTTP/route/SSR probes and say so in the log.
5. **Explore the code** for matching rough edges, missing coverage, and debt.
6. **Rank** by impact × confidence. Cap deferred list at 20 with one-line scores.
7. **File (or dry-run).** Hand candidates from the top to `file-github-issues` (batch preferred). Count only `filed #N` toward the cap.
8. **Log.** One comment on the current log issue. Include filed, commented, dropped, and **Deferred candidates** (at most 20, each with a one-line impact × confidence score). Any preflight degradation belongs under **Problems** with a `degraded:` or `repo-state:` tag.

## Log format (minimum)

Start with the required YAML header from `agent-workflow-protocol/references/log.md`, then prose:

```markdown
```yaml
step: Exploring
run: <RUN_ID>
runner: <name>
at: <UTC time>
outcome: "<N> filed, <M> commented, <K> dropped"
problems_count: <n>
```
**Step:** Exploring  **Run:** <RUN_ID>  **Runner:** <name>
**Outcome:** <N> filed, <M> commented, <K> dropped
**Items:** #N title…, duplicate of #X, dropped: reason…
**Deferred candidates:**
- [impact×confidence] title (why deferred)
**Problems:** degraded: no browser / repo-state: … / failed: … (or `none`)
**Things to improve:** … (or `none`)
```

Difficulties stay in this entry; there is no separate difficulty issue. One log issue covers `log_window_days` (two weeks by default).

## Success criteria

A good run, even with zero filings:

- Clear log entry with YAML header, outcome, and deferred list
- High-severity regressions or data-loss risks were either filed or explicitly deferred with reason
- Live-app vs code-only (or degraded) decision is recorded
- No labels applied, no destructive actions

## Never

- Apply, remove or change any label
- File more than `$explore_batch` issues
- Comment on, close or edit an issue other than the evidence comments `file-github-issues` adds
- Ask the user questions while `unattended` is `true`
- Hard-fail the whole run solely because the browser stack is missing when cheap probes remain possible
