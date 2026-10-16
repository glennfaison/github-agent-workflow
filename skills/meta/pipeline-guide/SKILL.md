---
name: pipeline-guide
description: Table of contents for the GitHub agent workflow package. Lists every skill, what it is for, and when to run or read it. Read-only index. Start here when you need to know which skill to use.
---

# Pipeline guide

The table of contents for this package. It says which skill to look for and when you need it. It is the only place that lists every skill: other files point here instead of repeating the list.

Call a skill by its name through the Skill tool (or `/name` where your runner has slash commands). Skills never link to each other by path, because where a skill lives depends on how the package was installed.

## Which skill, when

| Skill | Kind | Use it when |
|---|---|---|
| `pipeline-guide` | index | You do not know which skill you need. This file |
| `agent-workflow-protocol` | reference | Any pipeline skill tells you to. Leases, markers, trust, labels, handoffs, escalation, the run log, defaults, the no-shell path. Never run on its own |
| `setup-github-agent-workflow` | user-invoked | A maintainer is setting a repository up, once. Checks tools, records settings, creates labels |
| `runner-prompts` | user-invoked | You need the exact prompt to give a scheduler or runner. Prints one block per skill, listing every input with its default |
| `explore-github-repo` | group, Exploring | Finding new work: explore the live app and the code, rank findings, file the best |
| `file-github-issues` | item, Exploring | Filing one finding or a batch as issues after a duplicate check. Supports `dry_run`. Takes findings, not an existing issue, so it is plural |
| `triage-github-issues` | group, Triaging | Working through the open backlog: tidy finished issues, dispatch each untriaged one |
| `triage-github-issue` | item, Triaging | One specific issue needs to become `ready-for-agent`, `ready-for-human` or `needs-info` |
| `implement-github-issues` | group, Implementing | Starting work on the `ready-for-agent` issues |
| `implement-github-issue` | item, Implementing | One specific ready issue should be implemented and opened as a PR |
| `shepherd-github-prs` | group, Shepherding | Getting open agent PRs through CI |
| `shepherd-github-pr` | item, Shepherding | One specific PR has failing checks or open review findings, or is ready for its handoff |
| `review-github-prs` | group, Reviewing | Reviewing and merging the PRs that are ready |
| `review-github-pr` | item, Reviewing | One specific ready PR should be reviewed and, when safe, merged |
| `unattended-triage` | utility | Deciding an issue's category and state, and writing its outcome comment, with nobody to ask. Called by `triage-github-issue` |
| `grill-via-github-comments` | utility | Writing every question that is ready to ask as one round, each with a recommended answer. Called by `unattended-triage` |
| `merge-safety` | utility | Judging whether a PR is safe for an agent to merge. Called by `review-github-pr` |

**Group skills** select the work and dispatch it. Run one on a schedule. **Item skills** do the work on one issue or PR. Run one by hand on a number. **Utility skills** are building blocks that know nothing about GitHub plumbing. User-invoked skills can only be run by a person: no other skill can call them.

Two skills are not in this package: `tdd` and `code-review` from mattpocock/skills, which `implement-github-issue` and `review-github-pr` call.

## How the flow works

```
explore ──► triage ──► implement ──► shepherd ──► review ──► merged
 files        sorts       opens a      gets it       reviews and
 issues       issues      PR           through CI    merges when safe
```

The steps never call each other. They coordinate through labels, hidden marker comments and a lease on each item, so any step can run at any time. A flowchart for human readers is in the repository README.

| Step | Writes on the issue or PR |
|---|---|
| Exploring | New **unlabelled** issues, or evidence comments. Never touches labels |
| Triaging | Exactly one of `ready-for-agent`, `ready-for-human`, `needs-info`. Lease: `agent:triage` |
| Implementing | Opens a PR and sets `agent:pr-open` on the issue and `agent:needs-work` on the PR. Lease: `agent:in-progress` |
| Shepherding | Fixes failures, then the ready handoff and `agent:ready-for-review`. Lease: `agent:in-progress` |
| Reviewing | Merges pinned to the reviewed commit, or the review handoff and back to `agent:needs-work`. Lease: `agent:in-progress` |

## Inputs

**Free text.** Optional. Ignored: this skill is a read-only index.

**Key-value pairs.** None.

**Implicit dependencies.** None. It only describes the other skills.
