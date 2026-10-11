---
name: shepherd-github-prs
description: Find open agent PRs labelled agent:needs-work whose checks have finished and hand the oldest eligible ones to shepherd-github-pr, which fixes failures and posts the ready handoff. Use when asked to get open PRs through CI or run the Shepherding step. For one specific PR use shepherd-github-pr.
---

# Shepherd GitHub PRs

Pick the `agent:needs-work` PRs that can be worked on now, and give each to `shepherd-github-pr`. This skill never polls: a PR whose checks are still running is skipped, and a later run picks it up.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/labels.md`, `references/log.md` and `config.defaults.env`. If you have a shell, follow **Shell setup** in the protocol.

## Process

1. **List candidates.**

   ```bash
   gh pr list --state open --label agent:needs-work --limit 100 \
     --json number,url,title,createdAt,labels,isCrossRepository --jq '
     def names: [.labels[].name];
     [ .[] | select((names | any(. == "agent:stuck")) | not)
           | {number, url, title, createdAt, fork: .isCrossRepository} ] | sort_by(.createdAt)'
   ```

2. **Select.** Oldest first, apply `shepherd-github-pr`'s **Eligibility** (check state and lease) to each, and keep the first `$SHEPHERD_BATCH` that pass. Skipped PRs do not count toward the batch.
3. **Dispatch** each selected PR to `shepherd-github-pr` by its `url` (see **Dispatching** in the protocol). Collect each result line.
4. **Log it.** One run-log entry (`references/log.md`): each item's result and any **Problems**. Nothing eligible: log `nothing eligible` and stop.

## Never

- Shepherd a PR yourself, or claim one. Only `shepherd-github-pr` claims.
- Wait for CI to finish.
- Merge, approve or review. `review-github-prs` does that.
