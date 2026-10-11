---
name: review-github-prs
description: Find open, non-draft PRs labelled agent:ready-for-review and hand the oldest eligible ones to review-github-pr, which reviews each and merges it when it is safe. Use when asked to review and merge ready PRs or run the Reviewing step. For one specific PR use review-github-pr.
---

# Review GitHub PRs

Pick the `agent:ready-for-review` PRs that can be reviewed now, and give each to `review-github-pr`. This skill reviews and merges nothing itself.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/labels.md`, `references/log.md` and `config.defaults.env`. If you have a shell, follow **Shell setup** in the protocol.

## Process

1. **List candidates.**

   ```bash
   gh pr list --state open --label agent:ready-for-review --limit 100 \
     --json number,url,title,createdAt,labels,isDraft,isCrossRepository --jq '
     def names: [.labels[].name];
     [ .[] | select((.isDraft | not) and ((names | any(. == "agent:stuck")) | not))
           | {number, url, title, createdAt, fork: .isCrossRepository} ] | sort_by(.createdAt)'
   ```

2. **Select.** Oldest first, apply `review-github-pr`'s **Eligibility** (including the lease check) to each, and keep the first `$REVIEW_BATCH` that pass.
3. **Dispatch** each selected PR to `review-github-pr` by its `url` (see **Dispatching** in the protocol). Collect each result line.
4. **Log it.** One run-log entry (`references/log.md`): each item's result and any **Problems**. Nothing eligible: log `nothing eligible` and stop.

## Never

- Review or merge a PR yourself, or claim one. Only `review-github-pr` claims.
