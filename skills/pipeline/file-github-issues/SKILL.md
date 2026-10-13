---
name: file-github-issues
description: File one or more findings (bug, feature, refactor or debt) as GitHub issues in the repo's issue format, after checking for duplicates, with no labels. Comments on existing issues instead when a finding is already reported. Use for a single finding or a batch from explore-github-repo. Supports dry_run.
---

# File GitHub issues

File one or more findings. Check for duplicates first, then write each issue in the repo's format. Applies **no labels**: `triage-github-issues` picks the issues up later.

Supports a **batch** of candidates and an optional **dry_run** that only reports what would be filed.

**Read first (minimum):** the inlined rules below are enough for most runs. For the full protocol (leases, markers, other steps) call the Skill tool with `agent-workflow-protocol`.

## Inputs

**Free text.** One or more candidates. Each candidate needs: title, category (`bugfix`, `feature`, `refactor`, `debt`), area, impact, confidence, the evidence for that category's required sections, any related issue numbers, and any screenshots. Separate multiple candidates clearly (e.g. with headings or numbered blocks).

**Key-value pairs.** `key=value` on a line of its own. Recognised keys:

| Input | Default | What it does |
|---|---|---|
| `candidates` | *(from free text)* | Optional structured list; free text is also accepted |
| `dry_run` | `false` | When `true`, do not create issues or comments; only return the decisions |
| `dedupe_closed_days` | `30` | The "recently closed" window the duplicate search runs over |
| `run_id` | *(none)* | Exploring run id to record on filed issues |

Individual candidate fields (`title`, `category`, `area`, `impact`, `confidence`, `evidence`, `related`, `screenshots`) may also be supplied as key-value pairs for the single-candidate case.

**Implicit dependencies.** `agent-workflow-protocol` (for full rules and helpers when a shell is available) and the repository's existing issues. Without a shell, use GitHub MCP / connector tools (`search_issues`, `issue_write`, `add_issue_comment`) to perform the same operations.

## Eligibility

Always eligible. There is nothing to claim: this skill only reads, and the only thing it writes is new issues or evidence comments (unless `dry_run=true`).

## Process

For **each** candidate, in order:

1. **Dedupe.** Follow the Exploring column of the dedupe table (see `agent-workflow-protocol/references/dedupe.md` or the summary below). Search open issues, recently closed issues and `.out-of-scope/`.
2. **Decide**:
   - Same problem as an open issue → do not file. Add a comment with any **new** evidence (unless dry_run). Result: `duplicate of #N (commented)`.
   - Closed as not planned, or matches `.out-of-scope/` → do not file. Result: `dropped: rejected before in #N` (or the file).
   - Closed as completed → file it, and say "possible regression of #N" in the body.
   - Related but different → file it and mention `#N` in the body.
3. **Check required sections.** Each category marks sections **Required** (see issue-format). If you cannot fill one from the evidence, do not file. Result: `dropped: missing <section>` (or `dropped: no use case` for a feature). Never file a possible security vulnerability as a public issue.
4. **Write the body** following the category's title pattern and sections, plus common fields and a last line `Filed by Exploring run <RUN_ID>` when applicable. Prefer attaching screenshots only when the runner can put them on GitHub; otherwise note under **Visuals**.
5. **File it** (skip when `dry_run=true`). Create the issue with **no labels** and no assignee. Result: `filed #N`.

Stop early only if the caller asked for a hard limit; otherwise process the whole batch.

### Dedupe summary (Exploring)

| Finding | Action |
|---|---|
| Same problem, open issue | Comment new evidence; do not file |
| Same problem, closed as completed | File as possible regression |
| Same problem, closed as not planned / out-of-scope | Drop |
| Related but different | File and link |

### Required sections (minimum)

- **bugfix**: What happened / expected, Steps (or Trace), Severity
- **feature**: Use case (who, what they want, why it falls short today)
- **refactor / debt**: Problem, Cost of leaving it, Where

## Result

Return one line per candidate, in the same order:

- `filed #N`
- `duplicate of #N (commented)`
- `dropped: <reason>`
- `would-file: <title>` (only when `dry_run=true`)

## Never

- Apply, remove or change any label.
- Comment on, close or edit an issue other than the evidence comment in the dedupe step.
- File more issues than the caller requested when a limit is given.
