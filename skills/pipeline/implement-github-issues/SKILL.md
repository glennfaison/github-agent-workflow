---
name: implement-github-issues
description: Find open GitHub issues labelled ready-for-agent and hand the oldest eligible ones to implement-github-issue, which implements each and opens a PR. Use when asked to implement the ready backlog or run the Implementing step. For one specific issue use implement-github-issue.
---

# Implement GitHub issues

Pick the `ready-for-agent` issues that an agent can start now, and give each to `implement-github-issue`. This skill writes no code and never waits on CI.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/labels.md`, `references/log.md` and `config.defaults.env`.

## Process

1. **List candidates.**

   ```bash
   gh issue list --state open --label ready-for-agent --limit 100 --json number,url,title,createdAt,labels --jq '
     def names: [.labels[].name];
     [ .[] | select((names | any(. == "agent:stuck")) | not)
           | {number, url, title, createdAt, labels: names} ] | sort_by(.createdAt)'
   ```

2. **Select, dispatch and log**, as **Group skills** in the protocol describes: `implement-github-issue`'s **Eligibility**, the first `$IMPLEMENT_BATCH` that pass, one dispatch per `url`.

## Never

- Implement an issue yourself, or claim one. Only `implement-github-issue` claims.
- Wait for checks or fix CI. `shepherd-github-prs` does that.
