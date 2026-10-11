---
name: file-github-issue
description: File one finding (bug, feature, refactor or debt) as a GitHub issue in the repo's issue format, after checking for duplicates, with no labels. Comments on the existing issue instead when the finding is already reported. Use for a single finding to file, or when explore-github-repo hands you a candidate.
---

# File GitHub issue

File one finding. Check for duplicates first, then write the issue in the repo's format. Applies **no labels**: `triage-github-issues` picks the issue up later.

**Input:** one candidate: a title, a category (`bugfix`, `feature`, `refactor`, `debt`), an area, the evidence for that category's sections, any related issue numbers, and any screenshots.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/dedupe.md` and `references/issue-format.md`. If you have a shell, follow **Shell setup** in the protocol.

## Eligibility

Always eligible. There is nothing to claim: this skill only reads, and the only thing it writes is a new issue or an evidence comment.

## Process

1. **Dedupe.** Follow `references/dedupe.md`, using the **Exploring** column. Search open issues, recently closed issues and `.out-of-scope/`.
2. **Decide**, per that table:
   - Same problem as an open issue: do not file. Add a comment on that issue with any **new** evidence. Result: `duplicate of #N (commented)`.
   - Closed as not planned, or matches `.out-of-scope/`: do not file. Result: `dropped: rejected before in #N` (or the file).
   - Closed as completed: file it, and say "possible regression of #N" in the body.
   - Related but different: file it and mention `#N` in the body.
3. **Check the use case.** A feature must state who the user is, what they are trying to do, and why that falls short today. If it cannot, do not file. Result: `dropped: no use case`.
4. **Write the body** to a temporary file, following the category's tables in `references/issue-format.md`, plus an **Area**, a `Category:` line, and a last line `Filed by Exploring run <RUN_ID>`. Attach screenshots only if your runner can put them on GitHub. Otherwise fill **Visuals** with the "Not attached" note the reference describes.
5. **File it.** `gh issue create --title "…" --body-file FILE` with **no `--label` flags** and no assignee. Result: `filed #N`.

## Result

Return one line: `filed #N`, `duplicate of #N (commented)`, or `dropped: <reason>`. When a group skill called you, it logs the result. When you were run on your own, write a run-log entry for it (`references/log.md`).

## Never

- Apply, remove or change any label.
- Comment on, close or edit an issue other than the evidence comment in step 2.
