# Dedupe

Used by `file-github-issue` (the Exploring column below, before filing) and `triage-github-issue` (the Grooming column, on a claimed issue).

## Search

Search all of these using two or three distinctive keywords from the title and body:

1. Open issues: `gh issue list --state open --search "KEYWORDS" --json number,title,labels`
2. Issues closed in the last `EXPLORE_DEDUPE_CLOSED_DAYS` days: `gh issue list --state closed --search "KEYWORDS closed:>=YYYY-MM-DD" --json number,title,stateReason`
3. `.out-of-scope/`, if the directory exists (it is not there today; a skill may create it later).

Ignore issues labelled `agent:log`.

## Decide

| Finding | Exploring does | Grooming does |
|---|---|---|
| Same problem, open issue | Do not file. Comment on the existing issue with any new evidence. | Apply "canonical" rule below |
| Same problem, closed as completed | File it, and say "possible regression of #N" in the body | Keep the issue. Link `#N` in a comment and note "possible regression" |
| Same problem, closed as not planned | Do not file. Note it in the run log | Do not close. Link `#N`, say it was rejected before, and route to `ready-for-human` |
| Matches `.out-of-scope/` | Do not file. Note it in the run log | Do not close. Cite the file and route to `ready-for-human` for a human to confirm the match |
| Related but different | File it. Mention `#N` in the body | Link `#N` in a comment |

## Canonical rule (Grooming)

When two open issues are the same problem, **the lowest issue number is canonical.**

- If your claimed issue is the **higher** number: comment on the canonical issue ("Also reported in #M: <only details that are new>"). Do not edit its description. Then close your issue with `gh issue close M --reason "not planned" --comment "Duplicate of #N"` and finish.
- If your claimed issue is the **lower** number: only link the other one in a comment. Its own groomer will close it.

Only the claimed issue is ever closed, so no run needs a lease on another run's issue.
