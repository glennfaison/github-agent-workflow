---
name: implement-github-issues
description: Find open GitHub issues labelled ready-for-agent and hand the oldest eligible ones to implement-github-issue, which implements each and opens a PR. Use when asked to implement the ready backlog or run the Implementing step. For one specific issue use implement-github-issue.
---

# Implement GitHub issues

Pick the `ready-for-agent` issues that an agent can start now, and give each to `implement-github-issue`. This skill writes no code and never waits on CI.

**References:** call the Skill tool with `agent-workflow-protocol`. In that skill's directory, open `references/labels.md` before you read labels and `references/log.md` when you write the log entry.

## Contract

See **Contracts** in the protocol for what each key means.

```yaml
kind: group
step: Implementing
params: [implement_batch, runner, log_window_days, unattended, trusted_authors]
dispatches: implement-github-issue
requires:
  - "None: always runnable."
returns:
  - "The Result line of each dispatched issue, in dispatch order."
  - "nothing eligible"
ensures:
  - "At most implement_batch issues were dispatched, oldest first, each one passing implement-github-issue's requires. Issues labelled agent:stuck were not candidates."
  - "One run-log entry exists."
effects:
  reads: [open issues labelled ready-for-agent]
  writes:
    shared:
      - "One run-log entry."
never:
  - "Implement an issue itself, or claim one. Only implement-github-issue claims."
  - "Wait for checks or fix CI. shepherd-github-prs does that."
calls: []
idempotent: "Dispatch is idempotent because implement-github-issue is."
terminates: "One pass, bounded by implement_batch."
```

## Inputs

**Free text.** Any prose. This skill needs nothing from it: a repository is the only subject, and it is already checked out and authenticated.

**Key-value pairs.** `key=value` on a line of its own:

| Input | Default | What it does |
|---|---|---|
| `implement_batch` | `1` | The most issues this run dispatches before it stops |
| `runner` | `unknown` | Name recorded in the run id and the run log |
| `log_window_days` | `14` | Days one run-log issue is appended to before a new one starts |
| `unattended` | `true` | `true`: no human is present, so never ask (see **Unattended runs** in the protocol). `false`: a human may be asked |
| `trusted_authors` | *(none)* | Extra GitHub logins whose markers count, comma-separated (see **Trust** in the protocol) |

**Implicit dependencies.** The common ones (**Shell setup** and **Running without a shell** in the protocol), plus the repository's open issues to list.

## Process

1. **List candidates.**

   ```bash
   gh issue list --state open --label ready-for-agent --limit 100 --json number,url,title,createdAt,labels --jq '
     def names: [.labels[].name];
     [ .[] | select((names | any(. == "agent:stuck")) | not)
           | {number, url, title, createdAt, labels: names} ] | sort_by(.createdAt)'
   ```

2. **Select, dispatch and log**, as **Group skills and item skills** in the protocol describes: `implement-github-issue`'s `requires`, the first `$implement_batch` that pass, one dispatch per `url`.
