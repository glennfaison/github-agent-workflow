---
name: shepherd-github-prs
description: Find open agent PRs labelled agent:needs-work whose checks have finished and hand the oldest eligible ones to shepherd-github-pr, which fixes failures and posts the ready handoff. Use when asked to get open PRs through CI or run the Shepherding step. For one specific PR use shepherd-github-pr.
---

# Shepherd GitHub PRs

Pick the `agent:needs-work` PRs that can be worked on now, and give each to `shepherd-github-pr`. This skill never polls: a PR whose checks are still running is skipped, and a later run picks it up.

**References:** call the Skill tool with `agent-workflow-protocol`. In that skill's directory, open `references/labels.md` before you read labels and `references/log.md` when you write the log entry.

## Contract

See **Contracts** in the protocol for what each key means.

```yaml
kind: group
step: Shepherding
params: [shepherd_batch, runner, log_window_days, unattended, trusted_authors]
dispatches: shepherd-github-pr
requires:
  - "None: always runnable."
returns:
  - "The Result line of each dispatched PR, in dispatch order."
  - "nothing eligible"
ensures:
  - "At most shepherd_batch PRs were dispatched, oldest first, each one passing shepherd-github-pr's requires. PRs labelled agent:stuck or agent:human-merge were not candidates."
  - "A PR whose checks are still running was skipped, not waited for."
  - "Each dispatched item was given `write_log=false`, and every input of this run that it also lists in `params`."
  - "One run-log entry exists."
effects:
  reads: [open PRs labelled agent:needs-work, their check state]
  writes:
    shared:
      - text: "One run-log entry."
        allow: { op: comment, marker: null }
never:
  - "Shepherd a PR itself, or claim one. Only shepherd-github-pr claims."
  - "Wait for CI to finish."
  - "Merge, approve or review. review-github-prs does that."
calls: []
idempotent: "Dispatch is idempotent because shepherd-github-pr is."
terminates: "One pass, bounded by shepherd_batch."
```

## Inputs

**Free text.** Any prose. This skill needs nothing from it: a repository is the only subject, and it is already checked out and authenticated.

**Key-value pairs.** `key=value` on a line of its own:

| Input | Default | What it does |
|---|---|---|
| `shepherd_batch` | `3` | The most PRs this run dispatches before it stops |
| `runner` | `unknown` | Name recorded in the run id and the run log |
| `log_window_days` | `14` | Days one run-log issue is appended to before a new one starts |
| `unattended` | `true` | `true`: no human is present, so never ask (see **Unattended runs** in the protocol). `false`: a human may be asked |
| `trusted_authors` | *(none)* | Extra GitHub logins whose markers count, comma-separated (see **Trust** in the protocol) |

**Implicit dependencies.** The common ones (**Shell setup** and **Running without a shell** in the protocol), plus the repository's open PRs to list.

## Process

1. **List candidates.**

   ```bash
   gh pr list --state open --label agent:needs-work --limit 100 \
     --json number,url,title,createdAt,labels,isCrossRepository --jq '
     def names: [.labels[].name];
     [ .[] | select((names | any(. == "agent:stuck" or . == "agent:human-merge")) | not)
           | {number, url, title, createdAt, fork: .isCrossRepository} ] | sort_by(.createdAt)'
   ```

2. **Select, dispatch and log**, as **Group skills and item skills** in the protocol describes: `shepherd-github-pr`'s `requires` (check state and lease), the first `$shepherd_batch` that pass, one dispatch per `url`.
