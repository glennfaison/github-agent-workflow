---
name: pipeline-guide
description: Map of the GitHub agent workflow steps and which skill to run for each. Read-only index. Start here when deciding which pipeline skill to invoke.
---

# Pipeline guide

Read-only map of the issue-to-merge pipeline. Use this to decide which skill to run.

## Inputs

**Free text.** Optional. Ignored; this skill is a read-only index.

**Key-value pairs.** None.

**Implicit dependencies.** None. This skill only describes the other skills in the package.

## Steps

| Step | Group skill (selects work) | Item skill (one item) |
|---|---|---|
| Exploring | `explore-github-repo` | `file-github-issues` |
| Grooming | `triage-github-issues` | `triage-github-issue` |
| Implementing | `implement-github-issues` | `implement-github-issue` |
| Shepherding | `shepherd-github-prs` | `shepherd-github-pr` |
| Reviewing | `review-github-prs` | `review-github-pr` |

## Shared

- `agent-workflow-protocol` — leases, markers, labels, handoffs, escalation, run log, defaults, degraded/no-shell path. Reference material every other skill reads when needed.
- `setup-github-agent-workflow` — one-time repository setup (user-invoked).

## Utility skills the pipeline uses

- `grill-via-github-comments` — one round of questions with recommended answers when nobody is live.
- `unattended-triage` — category + state decision and the outcome comment.
- `merge-safety` — whether a PR is safe for an agent to merge.

## How to run

Point a scheduler at a group skill per step, or run an item skill by hand with an issue/PR number or URL. Skills coordinate through GitHub labels and marker comments; they never call each other directly.
