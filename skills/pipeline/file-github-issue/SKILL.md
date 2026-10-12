---
name: file-github-issue
description: File one finding (bug, feature, refactor or debt) as a GitHub issue in the repo's issue format, after checking for duplicates, with no labels. Comments on the existing issue instead when the finding is already reported. Use for a single finding to file, or when explore-github-repo hands you a candidate.
---

# File GitHub issue

File one finding. Check for duplicates first, then write the issue in the repo's format. Applies **no labels**: `triage-github-issues` picks the issue up later.

**Input:** one candidate: a title, a category (`bugfix`, `feature`, `refactor`, `debt`), an area, the impact and confidence, the evidence for that category's required sections, any related issue numbers, and any screenshots.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/dedupe.md` and `references/issue-format.md`.

## Inputs

**Free text.** The candidate exactly as the caller wrote it: title, category, area, impact, confidence, the evidence, related issue numbers and screenshots. A caller that has nothing to add beyond a sentence and a category is fine: the Process below decides whether that is enough to file.

**Key-value pairs.** `key=value` on a line of its own. Recognised keys:

| Input | Default | What it does |
|---|---|---|
| `title`, `category`, `area`, `impact`, `confidence`, `evidence`, `related`, `screenshots`, `run_id` | *(none)* | The candidate's fields, one per key. Each overrides the same field taken from the free text. `category` is `bugfix`, `feature`, `refactor` or `debt` |
| `dedupe_closed_days` | `30` | The "recently closed" window the duplicate search runs over |

**Implicit dependencies.** This skill also needs `agent-workflow-protocol` and its shell helpers (`scripts/lib.sh`) when a shell is available, and the repository's existing issues to search. Without a shell, do the same duplicate search and `gh issue create` with the tools you have.

## Eligibility

Always eligible. There is nothing to claim: this skill only reads, and the only thing it writes is a new issue or an evidence comment.

## Process

1. **Dedupe.** Follow `references/dedupe.md`, using the **Exploring** column. Search open issues, recently closed issues and `.out-of-scope/`.
2. **Decide**, per that table:
   - Same problem as an open issue: do not file. Add a comment on that issue with any **new** evidence. Result: `duplicate of #N (commented)`.
   - Closed as not planned, or matches `.out-of-scope/`: do not file. Result: `dropped: rejected before in #N` (or the file).
   - Closed as completed: file it, and say "possible regression of #N" in the body.
   - Related but different: file it and mention `#N` in the body.
3. **Check the required sections.** Each category in `references/issue-format.md` marks sections **Required**. If you cannot fill one from the evidence, do not file. Result: `dropped: missing <section>`, and for a feature with no use case, `dropped: no use case`. A possible security vulnerability is never filed as an issue: result `dropped: security, needs a private report`, and note it in the log without exploit details.
4. **Write the body** to a temporary file, following the category's section in `references/issue-format.md` (its title pattern too), plus the common fields it lists and a last line `Filed by Exploring run <RUN_ID>`. Attach screenshots only if your runner can put them on GitHub. Otherwise fill **Visuals** with the "Not attached" note the reference describes.
5. **File it.** `gh issue create --title "…" --body-file FILE` with **no `--label` flags** and no assignee. Result: `filed #N`.

## Result

Return one line: `filed #N`, `duplicate of #N (commented)`, or `dropped: <reason>`.

## Never

- Apply, remove or change any label.
- Comment on, close or edit an issue other than the evidence comment in step 2.
