---
name: triage-github-issues
description: Scan all open issues in the repo, tidy issues whose PRs have finished, and hand each untriaged issue to triage-github-issue so it ends up ready-for-agent, ready-for-human or needs-info. Use when asked to triage the backlog, run the Triaging step, or work through all open issues. For one specific issue use triage-github-issue.
---

# Triage GitHub issues

Go through the open issues as a group. Have `reconcile-github-issues` tidy the ones whose PRs are done, pick the issues that need triage, and give each to `triage-github-issue`. This skill does no triage and changes no issue itself.

**References:** call the Skill tool with `agent-workflow-protocol`. In that skill's directory, open `references/labels.md` before you read labels, and `references/log.md` when you write the log entry.

## Contract

See **Contracts** in the protocol for what each key means.

```yaml
kind: group
step: Triaging
params: [triage_batch, repo_guidance, runner, log_window_days, unattended, trusted_authors]
dispatches: triage-github-issue
requires:
  - "None: always runnable."
returns:
  - "The Result line of each dispatched issue, in dispatch order."
  - "nothing eligible"
ensures:
  - "reconcile-github-issues ran first, given write_log=false and the inputs of this run that it lists, and its result lines are in the log entry."
  - "At most triage_batch issues were dispatched, oldest first, each one passing triage-github-issue's requires."
  - "Each dispatched issue was given `write_log=false`, and every input of this run that it also lists in `params`."
  - "One run-log entry exists, listing what reconciling did."
effects:
  reads: [open issues with their labels]
  writes:
    shared:
      - text: "One run-log entry."
        allow: { op: comment, marker: null }
never:
  - "Triage an issue itself, or change code or PRs."
  - "Claim an issue. Only triage-github-issue claims."
  - "Change an issue's state itself. reconcile-github-issues does that, and its contract says what."
calls: [reconcile-github-issues]
idempotent: "Reconciling finds nothing to repair on a second run. Dispatch is idempotent because triage-github-issue is."
terminates: "One pass. Dispatch is bounded by triage_batch."
```

## Inputs

**Free text.** Any prose. This skill needs nothing from it: a repository is the only subject, and it is already checked out and authenticated.

**Key-value pairs.** `key=value` on a line of its own:

| Input | Default | What it does |
|---|---|---|
| `triage_batch` | `5` | The most issues this run triages before it stops |
| `repo_guidance` | `AGENTS.md` | Extra files holding the repository's own agent rules, read in addition to the standard locations (see `references/client-guidance.md`) |
| `runner` | `unknown` | Name recorded in the run id and the run log |
| `log_window_days` | `14` | Days one run-log issue is appended to before a new one starts |
| `unattended` | `true` | `true`: no human is present, so never ask (see **Unattended runs** in the protocol). `false`: a human may be asked |
| `trusted_authors` | *(none)* | Extra GitHub logins whose markers count, comma-separated (see **Trust** in the protocol) |

**Implicit dependencies.** The common ones (**Shell setup** and **Running without a shell** in the protocol), plus the repository's open issues to list.

## Process

1. **Reconcile.** Call the Skill tool with `reconcile-github-issues`. Give it `write_log=false` and every input of this run that it lists (`repo_guidance`, `runner`, `log_window_days`, `unattended`, `trusted_authors`). Keep its result lines for the log entry.

2. **List candidates.**

   ```bash
   gh issue list --state open --limit 200 --json number,url,title,createdAt,labels --jq '
     def names: [.labels[].name];
     [ .[] | select((names | map(IN("agent:log","agent:difficulty","agent:stuck","agent:pr-open","needs-info","ready-for-agent","ready-for-human")) | any) | not)
           | {number, url, title, createdAt, labels: names} ] | sort_by(.createdAt)'
   ```

3. **Select, dispatch and log**, as **Group skills and item skills** in the protocol describes: `triage-github-issue`'s `requires`, the first `$triage_batch` that pass, one dispatch per `url`. The run-log entry (`references/log.md`) also lists what reconciling did. Nothing eligible and nothing reconciled: log `nothing eligible` and stop.
