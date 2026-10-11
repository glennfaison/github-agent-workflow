---
name: implement-github-issues
description: Find open GitHub issues labelled ready-for-agent and hand the oldest eligible ones to implement-github-issue, which implements each and opens a PR. Use when asked to implement the ready backlog or run the Implementing step. For one specific issue use implement-github-issue.
---

# Implement GitHub issues

Pick the `ready-for-agent` issues that an agent can start now, and give each to `implement-github-issue`. This skill writes no code and never waits on CI.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/labels.md`, `references/log.md` and `config.defaults.env`. If you have a shell, follow **Shell setup** in the protocol.

## Process

1. **List candidates.**

   ```bash
   gh issue list --state open --label ready-for-agent --limit 100 --json number,url,title,createdAt,labels --jq '
     def names: [.labels[].name];
     [ .[] | select((names | any(. == "agent:stuck")) | not)
           | {number, url, title, createdAt, labels: names} ] | sort_by(.createdAt)'
   ```

2. **Select.** Oldest first, apply `implement-github-issue`'s **Eligibility** (including the lease check) to each, and keep the first `$IMPLEMENT_BATCH` that pass.
3. **Dispatch** each selected issue to `implement-github-issue` by its `url` (see **Dispatching** in the protocol). Collect each result line.
4. **Log it.** One run-log entry (`references/log.md`): each item's result and any **Problems**. Nothing eligible: log `nothing eligible` and stop.

## Never

- Implement an issue yourself, or claim one. Only `implement-github-issue` claims.
- Wait for checks or fix CI. `shepherd-github-prs` does that.
