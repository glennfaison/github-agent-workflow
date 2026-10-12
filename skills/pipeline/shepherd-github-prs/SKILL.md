---
name: shepherd-github-prs
description: Find open agent PRs labelled agent:needs-work whose checks have finished and hand the oldest eligible ones to shepherd-github-pr, which fixes failures and posts the ready handoff. Use when asked to get open PRs through CI or run the Shepherding step. For one specific PR use shepherd-github-pr.
---

# Shepherd GitHub PRs

Pick the `agent:needs-work` PRs that can be worked on now, and give each to `shepherd-github-pr`. This skill never polls: a PR whose checks are still running is skipped, and a later run picks it up.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/labels.md` and `references/log.md`.

## Inputs

**Free text.** Any prose. This skill needs nothing from it: a repository is the only subject, and it is already checked out and authenticated.

**Key-value pairs.** `key=value` on a line of its own:

| Input | Default | What it does |
|---|---|---|
| `shepherd_batch` | `3` | The most PRs this run dispatches before it stops |

**Implicit dependencies.** This skill also needs `agent-workflow-protocol` and its shell helpers (`scripts/lib.sh`) when a shell is available, and the repository's open PRs to list. Without a shell, list and dispatch through the tools you have.

## Process

1. **List candidates.**

   ```bash
   gh pr list --state open --label agent:needs-work --limit 100 \
     --json number,url,title,createdAt,labels,isCrossRepository --jq '
     def names: [.labels[].name];
     [ .[] | select((names | any(. == "agent:stuck")) | not)
           | {number, url, title, createdAt, fork: .isCrossRepository} ] | sort_by(.createdAt)'
   ```

2. **Select, dispatch and log**, as **Group skills** in the protocol describes: `shepherd-github-pr`'s **Eligibility** (check state and lease), the first `$shepherd_batch` that pass, one dispatch per `url`.

## Never

- Shepherd a PR yourself, or claim one. Only `shepherd-github-pr` claims.
- Wait for CI to finish.
- Merge, approve or review. `review-github-prs` does that.
