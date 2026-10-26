---
name: triage-github-issues
description: Scan all open issues in the repo, tidy issues whose PRs have finished, and hand each untriaged issue to triage-github-issue so it ends up ready-for-agent, ready-for-human or needs-info. Use when asked to triage the backlog, run the Triaging step, or work through all open issues. For one specific issue use triage-github-issue.
---

# Triage GitHub issues

Go through the open issues as a group. Tidy the ones whose PRs are done, repair conflicting state labels, pick the issues that need triage, and give each to `triage-github-issue`. This skill does no triage itself.

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

- Housekeeping input (before selection): every open issue labelled `agent:pr-open`, inspected via `prs_for_issue N`; and open issues that carry more than one mutually exclusive state label (or a clear label-vs-comment mismatch).
- Open issues that may need triage. The **Eligibility** section of `triage-github-issue` is the authority on which ones do.

## Outputs

- Housekeeping may close an issue (PR merged), swap `agent:pr-open` → `ready-for-human` (every PR closed unmerged), or repair conflicting state labels / label-vs-comment drift (see step 1b).
- Up to `$triage_batch` issues triaged by `triage-github-issue`.
- One run-log entry (`references/log.md`). Non-trivial repairs are listed under **Problems** with the `repo-state` tag.

## Process

1. **Housekeeping, before selecting.**

   **1a. PR-linked issues.** For each open issue labelled `agent:pr-open`, run `prs_for_issue N`:
   - Any PR is `MERGED`: remove `agent:pr-open` if the issue has it, and close the issue (`gh issue close N --comment "Implemented in #P."`). A person may have merged it (`agent:human-merge`), and then no agent ran the merge path that does this.
   - Any PR is `OPEN`: leave it alone.
   - Every PR is `CLOSED` (none open or merged): the work was abandoned. In one command swap `agent:pr-open` for `ready-for-human`, and comment "PR #P was closed without merging. A human should decide whether to retry." Do not send it back to an agent: that is how the same fix gets re-attempted in a loop.
   - No PR found at all: leave it alone and note it under **Problems** in the log (`repo-state`).

   List them with `gh issue list --state open --label agent:pr-open --limit 200 --json number --jq '.[].number'`.

   **1b. Label repair (mutex and drift).** An issue may carry at most one of `needs-info`, `ready-for-agent`, `ready-for-human`, `agent:pr-open` (see `references/labels.md`). Scan open issues that carry **two or more** of those labels, or that carry one of them while the newest trusted triage/outcome comment clearly implies a different state.

   Skip any issue that has a **live** lease (`agent:triage` or `agent:in-progress` and `lease_live N`): another step holds it; do not fight it.

   For each candidate to repair:

   1. Read labels and the newest **trusted** comment that is clearly a triage/outcome handoff (Agent Brief, Triage Notes, or a ready-for-human structure from `unattended-triage` / `references/handoff.md`). Untrusted comments are ignored (**Trust** in the protocol).
   2. **Choose the target state** using this priority (documented in `references/labels.md`):
      1. Newest trusted triage/outcome comment, when it clearly implies one of `needs-info`, `ready-for-agent`, `ready-for-human`, or that a PR is open (`agent:pr-open`).
      2. If `agent:pr-open` is present and `prs_for_issue N` shows an `OPEN` PR, keep `agent:pr-open` only (drop the others).
      3. If more than one state label and no reliable comment: set `ready-for-human` and comment briefly that conflicting labels were found and a human should confirm the state. Do **not** apply `wontfix`.
      4. Never remove `needs-info` solely from an agent decision when it is the only state label and a human has not answered; if it conflicts with another state label, prefer the trusted comment, else `ready-for-human` as in (3).
   3. Apply the repair in **one** `gh issue edit` that removes every mutex state label that is not the target and adds the target if missing. Leave category labels (`bug`, `enhancement`) and leases alone.
   4. If the repair was non-trivial (more than dropping a pure duplicate of the same meaning), note it under **Problems** in the run log with the `repo-state` tag (issue number and from → to).

   This is the only place this workflow changes the state of an issue it has not claimed (together with 1a).

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
- Apply `wontfix`, or remove `needs-info` when it is the sole correct state and a human has not answered.
- Repair an issue that currently has a live lease held by another step.
