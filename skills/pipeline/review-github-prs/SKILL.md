---
name: review-github-prs
description: Find open, non-draft PRs labelled agent:ready-for-review and hand the oldest eligible ones to review-github-pr, which reviews each and merges it when it is safe. Use when asked to review and merge ready PRs or run the Reviewing step. For one specific PR use review-github-pr.
---

# Review GitHub PRs

Pick the `agent:ready-for-review` PRs that can be reviewed now, and give each to `review-github-pr`. This skill reviews and merges nothing itself.

**References:** call the Skill tool with `agent-workflow-protocol`. In that skill's directory, open `references/labels.md` before you read labels and `references/log.md` when you write the log entry.

## Inputs

**Free text.** Any prose. This skill needs nothing from it: a repository is the only subject, and it is already checked out and authenticated.

**Key-value pairs.** `key=value` on a line of its own:

| Input | Default | What it does |
|---|---|---|
| `review_batch` | `3` | The most PRs this run dispatches before it stops |
| `runner` | `unknown` | Name recorded in the run id and the run log |
| `log_window_days` | `14` | Days one run-log issue is appended to before a new one starts |
| `unattended` | `true` | `true`: no human is present, so never ask (see **Unattended runs** in the protocol). `false`: a human may be asked |
| `trusted_authors` | *(none)* | Extra GitHub logins whose markers count, comma-separated (see **Trust** in the protocol) |

**Implicit dependencies.** The common ones (**Shell setup** and **Running without a shell** in the protocol), plus the repository's open PRs to list.

## Process

1. **List candidates.**

   ```bash
   gh pr list --state open --label agent:ready-for-review --limit 100 \
     --json number,url,title,createdAt,labels,isDraft,isCrossRepository --jq '
     def names: [.labels[].name];
     [ .[] | select((.isDraft | not) and ((names | any(. == "agent:stuck" or . == "agent:human-merge")) | not))
           | {number, url, title, createdAt, fork: .isCrossRepository} ] | sort_by(.createdAt)'
   ```

2. **Select, dispatch and log**, as **Group skills and item skills** in the protocol describes: `review-github-pr`'s **Eligibility**, the first `$review_batch` that pass, one dispatch per `url`.

## Never

- Review or merge a PR yourself, or claim one. Only `review-github-pr` claims.
