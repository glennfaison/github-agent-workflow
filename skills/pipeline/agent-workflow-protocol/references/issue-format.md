# Issue format

What a well-formed issue contains. `file-github-issue` **writes** to this format, `triage-github-issue` **checks** against it, and `implement-github-issue` **reads** it. The headings mirror `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml`, so agent-filed and human-filed issues look alike.

Agents never apply labels when filing. (The templates add `bug` and `enhancement` for humans; agent-filed issues get their labels during Grooming.) Put the category on a `Category:` line in the body instead.

## Every issue

- **Area**, one of: Editor / page builder, Design components, Data sources / placeholders, Templates, Import / export (JSON, shortcode), Standalone HTML export, Command palette / theme, Docs / tooling / CI, Other.
- A last line `Filed by Exploring run <RUN_ID>` when an agent filed it.

## By category

### Bug (`Category: bugfix`)

| Section | Content |
|---|---|
| What happened? | What went wrong, and what was expected instead |
| Steps to reproduce | Numbered, starting from a URL or page state |
| Page JSON or shortcode | A minimal page that reproduces it, if relevant |
| Environment | Browser and version, OS, the URL tested and the commit or deployment if known |
| Visuals | Screenshot of the faulty state, if possible |

### Feature (`Category: feature`)

| Section | Content |
|---|---|
| **Problem (the use case). Required.** | Who the user is, what they are trying to get done, what they have to do today, and why that falls short. Tell it as a concrete scenario, for example "A designer building a pricing page wants X, but today must Y." Not a description of the solution. |
| Proposed solution | The behaviour the user should see, in terms of the user, not the implementation |
| Visuals | See below. If possible |
| Acceptance criteria | Testable outcomes, as a checklist (optional) |
| Alternatives considered | (optional) |

A feature with no use case is **not ready**, however clear the proposed solution looks.

### Refactor or debt (`Category: refactor` / `Category: debt`)

| Section | Content |
|---|---|
| Problem | What is wrong with the current code |
| Cost of leaving it | What it slows down, breaks or risks |
| Where | File paths and symbols |
| Suggested direction | (optional) |

## Visuals

For a bug, a screenshot of the broken state. For a feature, one of: an annotated screenshot of the current screen showing where the change belongs, a sketch or mockup of the desired result, or a screenshot of a comparable behaviour elsewhere.

- Capture with the runner's browser tool or Playwright (a dev dependency): `npx playwright screenshot URL out.png`.
- **`gh` cannot upload images.** Attach a screenshot only if your runner has a way to put it on GitHub (for example a browser tool that drags it into the issue editor). Never link to a local file path, and do not commit images to the repository for this.
- If you cannot attach it, say so under **Visuals**: `Not attached: <what a human should capture and where>`. Then describe the screen in words (what is on it, where the change goes). Do not skip the section.
- **A missing image never blocks an issue. A missing use case always does.**

## Grooming's check

For the issue's category, compare the description with the tables above.

| What is missing | Grooming does |
|---|---|
| A section that evidence in the issue, comments, code or ADRs can fill | Add it to the description |
| The **use case** of a feature that cannot be inferred | Ask for it, as a specific question, in a comment. The issue becomes `needs-info` |
| Any other required section that cannot be inferred | Ask for it. The issue becomes `needs-info` |
| Visuals only | Add the "Not attached" note if absent. Do not block on it |
