---
name: implement-github-issues
description: Find open GitHub issues labelled ready-for-agent and hand the oldest eligible ones to implement-github-issue, which implements each and opens a PR. Use when asked to implement the ready backlog or run the Implementing step. For one specific issue use implement-github-issue.
---

# Implement GitHub issues

Pick the `ready-for-agent` issues that an agent can start now, and give each to `implement-github-issue`. This skill writes no code and never waits on CI.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/labels.md` and `references/log.md`.

## Inputs

**Free text.** Any prose. This skill needs nothing from it: a repository is the only subject, and it is already checked out and authenticated.

**Key-value pairs.** `key=value` on a line of its own:

| Input | Default | What it does |
|---|---|---|
| `implement_batch` | `1` | The most issues this run dispatches before it stops |

**Implicit dependencies.** This skill also needs `agent-workflow-protocol` and its shell helpers (`scripts/lib.sh`) when a shell is available, and the repository's open issues to list. Without a shell, list and dispatch through the tools you have.

## Process

1. **List candidates.**

   ```bash
   gh issue list --state open --label ready-for-agent --limit 100 --json number,url,title,createdAt,labels --jq '
     def names: [.labels[].name];
     [ .[] | select((names | any(. == "agent:stuck")) | not)
           | {number, url, title, createdAt, labels: names} ] | sort_by(.createdAt)'
   ```

2. **Select, dispatch and log**, as **Group skills** in the protocol describes: `implement-github-issue`'s **Eligibility**, the first `$implement_batch` that pass, one dispatch per `url`.

## Never

- Implement an issue yourself, or claim one. Only `implement-github-issue` claims.
- Wait for checks or fix CI. `shepherd-github-prs` does that.
