---
name: explore-github-repo
description: Explore a repository's live app and its codebase, rank what you find, and file the most valuable findings as unlabelled GitHub issues through file-github-issue. Use when asked to explore the repo or app, hunt for bugs, rough edges or missing features, or run the Exploring step of the GitHub workflow. Read-only on the app and the code.
---

# Explore GitHub repo

Explore the live app and the codebase, then file the most valuable findings as issues. This skill applies **no labels**: `triage-github-issues` picks up unlabelled issues.

**Input:** the URL of the live app to explore. Optional. Use the URL in the prompt, otherwise `$APP_URL`. If both are empty, explore the code only and say so in the log. Never ask for it.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/log.md`, `references/issue-format.md` and `config.defaults.env`. If you have a shell, follow **Shell setup** in the protocol.

## Inputs

- The monthly run log (`read_logs "$EXPLORE_LOG_LOOKBACK_DAYS"`): deferred candidates from earlier Exploring runs, recurring problems (failures, escalations, flaky checks, repeatedly skipped items), and automation suggestions.
- The live app at the input URL or `$APP_URL`, if there is one (read-only; test data only).
- The codebase (read-only).

This skill does **not** select by label, claim work, or take a lease. It only reads.

## Outputs

- Up to `$EXPLORE_ISSUE_CAP` new GitHub issues, filed by `file-github-issue` with no labels and no assignee.
- Comments on existing issues when a candidate is a duplicate (also done by `file-github-issue`). These do not count toward the cap.
- A run-log entry (`references/log.md`) listing issues filed, dedupe comments, dropped candidates, and **Deferred candidates** (the rest of the ranked list, at most 20 lines).

## Process

1. **Read the run log.** `read_logs "$EXPLORE_LOG_LOOKBACK_DAYS"`. Collect:
   - **Deferred candidates** left by earlier Exploring runs.
   - **Problems** that recur: repeated failures, escalations, flaky checks, items skipped again and again.
   - **Automation suggestions**.

   Each becomes a candidate in step 4.
2. **Explore the live app.** Open the input URL (or `$APP_URL`) and use it as a user would. Look for bugs, rough edges and missing features. If there is no URL, or you cannot browse it, skip this step and say so in the log.
3. **Explore the codebase.** Read for architecture problems, technical debt, refactor opportunities and missing functionality.
   - The live app and the code are read-only. Use test data only. Take no destructive action against the target.
4. **Build the candidate list. Do not cap it.** For each: a title, a category (`bugfix`, `feature`, `refactor`, `debt`), the evidence for that category (see `references/issue-format.md`), and the impact. **For a feature, write the use case before anything else:** who the user is, what they are trying to do, and why that falls short today. If you cannot state a use case, it is not a feature candidate: drop it or reword it as a question in the log. While exploring the live app, capture screenshots for bugs and for the screen where a feature would live.
5. **Rank the list.** Rank by severity times confidence first: user-facing breakage and data loss, backed by a reproduction, beat guesses. Break ties by value per effort.
6. **File from the top of the list.** Walk the ranked list in order. Hand each candidate to `file-github-issue` (title, category, area, evidence, related issue numbers, screenshots, `$RUN_ID`). These calls are short, so run them in this context. Keep a tally of each result:
   - `filed #N` counts toward the cap.
   - A duplicate (comment added to an existing issue) or a dropped candidate does **not** count. Move on to the next one.

   Stop when `$EXPLORE_ISSUE_CAP` issues are filed or the list is used up.
7. **Log it.** Follow `references/log.md`. Include the issues filed, the comments added, the candidates dropped as duplicates or rejected earlier, and **Deferred candidates**: the ranked candidates you did not reach, one line each, at most 20.

## Never

- Apply, remove or change any label.
- File more than `$EXPLORE_ISSUE_CAP` issues in one run.
- Comment on, close or edit an issue other than the evidence comments `file-github-issue` adds.
