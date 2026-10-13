# Issue format

`file-github-issues` writes this format; `triage-github-issue` checks it; `implement-github-issue` reads it.

## Every issue

- Title (category pattern)
- `Category:` line (`bugfix` | `feature` | `refactor` | `debt`)
- **Area**, **Impact**, **Confidence** (`reproduced` | `traced` | `suspected`)
- Last line: `Filed by Exploring run <RUN_ID>` when agent-filed

## Required by category

### bugfix
What happened / expected; Steps or Trace; Severity (`data-loss` | `crash-or-blocked` | `wrong-result` | `degraded` | `cosmetic`)

### feature
**Use case** first (who, what, why it falls short today)

### refactor / debt
Problem; Cost of leaving it; Where

Never file security vulnerabilities as public issues.
