# Issue format

What a well-formed issue contains. `file-github-issue` **writes** to this format, `triage-github-issue` **checks** against it, and `implement-github-issue` **reads** it.

If the repository has issue templates (`.github/ISSUE_TEMPLATE/`), use their headings and field names for the sections below, so agent-filed and human-filed issues look alike. The tables name what each section must hold; the template decides what it is called.

Agents never apply labels when filing. (The templates add `bug` and `enhancement` for humans; agent-filed issues get their labels during Grooming.) Put the category on a `Category:` line in the body instead. Grooming maps it to a label: `bugfix` is `bug`; `feature`, `refactor` and `debt` are `enhancement`.

## Every issue

| Field | Content |
|---|---|
| Title | The category's pattern below |
| `Category:` line | `bugfix`, `feature`, `refactor` or `debt` |
| **Area** | An option of the **Area** dropdown in the repository's issue template when it has one. Otherwise a short phrase naming the part of the product or codebase affected, or `Other` |
| **Impact** | One line: who or what is affected, and how badly |
| **Confidence** | `reproduced` (you saw it), `traced` (you followed the code to a cause but did not run it) or `suspected`. Exploring ranks by it. Grooming tries to reproduce anything below `reproduced` and updates the line |
| Last line | `Filed by Exploring run <RUN_ID>` when an agent filed it |

## By category

A section marked **Required** must be filled. If Grooming cannot fill it from the issue, comments, code or ADRs, it asks for it and the issue becomes `needs-info`. Every other section is optional.

### Bug (`Category: bugfix`)

Title: `<area>: <symptom>`

| Section | Content |
|---|---|
| **What happened, and what was expected.** Required | The observed behaviour and the expected one |
| **Steps to reproduce.** Required | Numbered, starting from a URL or page state. If you could not run it, give a **Trace** instead: the code path that causes it, by symbol, and set Confidence to `traced` |
| **Severity.** Required | One of `data-loss`, `crash-or-blocked`, `wrong-result`, `degraded`, `cosmetic` |
| Frequency and reach | Always, intermittent (how often) or once. Who is affected |
| Reproduction input | The smallest input that reproduces it (a file, payload, saved document or page state), if relevant |
| Evidence | The error message, the log or console lines, the stack trace or the failing test. Redact secrets and personal data |
| Regression | Since which commit or version, if known. Otherwise leave it out |
| Environment | Browser and version, OS, the URL tested and the commit or deployment if known |
| Visuals | See **Visuals** |

### Feature (`Category: feature`)

Title: what the user can do, in the user's words, not the implementation.

| Section | Content |
|---|---|
| **Problem (the use case).** Required | Who the user is, what they are trying to get done, what they have to do today, and why that falls short. Tell it as a concrete scenario, for example "A designer building a pricing page wants X, but today must Y." Not a description of the solution |
| **Proposed solution.** Required | The behaviour the user should see, in terms of the user, not the implementation |
| Visuals | See **Visuals** |
| Acceptance criteria | Testable outcomes, as a checklist |
| Non-goals | What this should not grow into |
| Alternatives considered | |

A feature with no use case is **not ready**, however clear the proposed solution looks.

### Refactor (`Category: refactor`)

Title: `Refactor <what> to <benefit>`

| Section | Content |
|---|---|
| **Problem.** Required | What is wrong with the current structure |
| **Behaviour guard.** Required | How anyone can tell behaviour did not change: the existing tests that cover the code, or a note that a characterization test must be written first |
| **Where.** Required | File paths and symbols |
| Cost of leaving it | What it slows down, breaks or risks |
| Size | `small`, `medium` or `large`. If `large`, propose how to split it |
| Suggested direction | |

### Debt (`Category: debt`)

Title: `<what> costs <cost>`

| Section | Content |
|---|---|
| **Problem.** Required | What is wrong with the current code, tests, tooling or docs |
| **Cost of leaving it.** Required | What it slows down, breaks or risks, with a number or an example when you have one (a flaky test's rerun rate, a build's duration, how many copies of the same code) |
| **Where.** Required | File paths and symbols |
| Done when | A measurable end state |
| Suggested direction | |

### Possible vulnerability

Never file one as an issue: an open issue publishes it. Exploring drops it and notes it in the log with its area and no exploit details. Grooming that meets one that was filed anyway sets `ready-for-human` and says to move it to a private security report.

## Visuals

For a bug, a screenshot of the broken state. For a feature, one of: an annotated screenshot of the current screen showing where the change belongs, a sketch or mockup of the desired result, or a screenshot of a comparable behaviour elsewhere.

- Capture with the runner's browser tool or Playwright (a dev dependency): `npx playwright screenshot URL out.png`.
- **`gh` cannot upload images.** Attach a screenshot only if your runner has a way to put it on GitHub (for example a browser tool that drags it into the issue editor). Never link to a local file path, and do not commit images to the repository for this.
- If you cannot attach it, say so under **Visuals**: `Not attached: <what a human should capture and where>`. Then describe the screen in words (what is on it, where the change goes). Do not skip the section.
- **A missing image never blocks an issue. A missing Required section always does.**

## Grooming's check

For the issue's category, compare the description with the tables above.

| What is missing | Grooming does |
|---|---|
| A section that evidence in the issue, comments, code or ADRs can fill | Add it to the description |
| A Required section that cannot be inferred (a feature's use case, a bug's severity or steps, a refactor's behaviour guard) | Ask for it, as a specific question, in a comment. The issue becomes `needs-info` |
| Confidence below `reproduced` | Try to reproduce it, and update the line |
| Visuals only | Add the "Not attached" note if absent. Do not block on it |
