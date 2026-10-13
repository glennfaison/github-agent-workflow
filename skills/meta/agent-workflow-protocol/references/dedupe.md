# Dedupe

Used by `file-github-issues` (Exploring column) and `triage-github-issue` (Grooming column).

## Search

Search open issues, issues closed in the last `dedupe_closed_days` days, and `.out-of-scope/` using distinctive keywords. Ignore `agent:log` issues.

## Decide

| Finding | Exploring | Grooming |
|---|---|---|
| Same problem, open issue | Comment new evidence; do not file | Canonical rule (lowest number wins) |
| Same problem, closed as completed | File as possible regression | Keep; note regression |
| Same problem, closed as not planned | Drop | ready-for-human |
| Matches `.out-of-scope/` | Drop | ready-for-human |
| Related but different | File and link | Link in comment |
