---
name: triage-github-issues
description: Scan all open issues in the repo, tidy issues whose PRs have finished, and hand each untriaged issue to triage-github-issue so it ends up ready-for-agent, ready-for-human or needs-info. Use when asked to triage the backlog, run the Triaging step, or work through all open issues. For one specific issue use triage-github-issue.
---

# Triage GitHub issues

Go through the open issues as a group. Tidy the ones whose PRs are done, pick the issues that need triage, and give each to `triage-github-issue`. This skill does no triage itself.

**References:** call the Skill tool with `agent-workflow-protocol`. In that skill's directory, open `references/labels.md` before you read labels and `references/log.md` when you write the log entry.

## Inputs

**Free text.** Any prose. This skill needs nothing from it: a repository is the only subject, and it is already checked out and authenticated.

**Key-value pairs.** `key=value` on a line of its own:

| Input | Default | What it does |
|---|---|---|
| `triage_batch` | `5` | The most issues this run triages before it stops |
| `runner` | `unknown` | Name recorded in the run id and the run log |
| `log_window_days` | `14` | Days one run-log issue is appended to before a new one starts |
| `unattended` | `true` | `true`: no human is present, so never ask (see **Unattended runs** in the protocol). `false`: a human may be asked |
| `trusted_authors` | *(none)* | Extra GitHub logins whose markers count, comma-separated (see **Trust** in the protocol) |

**Implicit dependencies.** The common ones (**Shell setup** and **Running without a shell** in the protocol), plus the repository's open issues to list.

## Context read

- Housekeeping input (before selection): every open issue labelled `agent:pr-open`, inspected via `prs_for_issue N`.
- Open issues that may need triage. The **Eligibility** section of `triage-github-issue` is the authority on which ones do.

## Outputs

- Housekeeping may close an issue (PR merged) or swap `agent:pr-open` → `ready-for-human` (every PR closed unmerged).
- Up to `$triage_batch` issues triaged by `triage-github-issue`.
- One run-log entry (`references/log.md`).

## Process

1. **Housekeeping, before selecting.** For each open issue labelled `agent:pr-open`, run `prs_for_issue N`:
   - Any PR is `MERGED`: close the issue (`gh issue close N --comment "Implemented in #P."`).
   - Any PR is `OPEN`: leave it alone.
   - Every PR is `CLOSED` (none open or merged): the work was abandoned. In one command swap `agent:pr-open` for `ready-for-human`, and comment "PR #P was closed without merging. A human should decide whether to retry." Do not send it back to an agent: that is how the same fix gets re-attempted in a loop.
   - No PR found at all: leave it alone and note it under **Problems** in the log (`repo-state`).

   List them with `gh issue list --state open --label agent:pr-open --limit 200 --json number --jq '.[].number'`.

   This is the only place this workflow changes the state of an issue it has not claimed.
2. **List candidates.**

   ```bash
   gh issue list --state open --limit 200 --json number,url,title,createdAt,labels --jq '
     def names: [.labels[].name];
     [ .[] | select((names | map(IN("agent:log","agent:difficulty","agent:stuck","agent:pr-open","needs-info","ready-for-agent","ready-for-human")) | any) | not)
           | {number, url, title, createdAt, labels: names} ] | sort_by(.createdAt)'
   ```

3. **Select, dispatch and log**, as **Group skills and item skills** in the protocol describes: `triage-github-issue`'s **Eligibility**, the first `$triage_batch` that pass, one dispatch per `url`. The run-log entry (`references/log.md`) also lists the housekeeping you did. Nothing eligible and no housekeeping: log `nothing eligible` and stop.

## Never

- Triage an issue yourself, or change code or PRs.
- Claim an issue. Only `triage-github-issue` claims.
- Change the state of an issue other than the housekeeping above.
