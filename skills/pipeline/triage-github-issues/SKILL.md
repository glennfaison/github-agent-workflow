---
name: triage-github-issues
description: Scan all open issues in the repo, tidy issues whose PRs have finished, and hand each untriaged issue to triage-github-issue so it ends up ready-for-agent, ready-for-human or needs-info. Use when asked to triage or groom the backlog, run the Grooming step, or work through all open issues. For one specific issue use triage-github-issue.
---

# Triage GitHub issues

Go through the open issues as a group. Tidy the ones whose PRs are done, pick the issues that need triage, and give each to `triage-github-issue`. This skill does no triage itself.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/labels.md`, `references/log.md` and `config.defaults.env`. If you have a shell, follow **Shell setup** in the protocol.

## Inputs

- Housekeeping input (before selection): every open issue labelled `agent:pr-open`, inspected via `prs_for_issue N`.
- Open issues that may need triage. The **Eligibility** section of `triage-github-issue` is the authority on which ones do.

## Outputs

- Housekeeping may close an issue (PR merged) or swap `agent:pr-open` → `ready-for-human` (every PR closed unmerged).
- Up to `$GROOM_BATCH` issues triaged by `triage-github-issue`.
- One run-log entry (`references/log.md`).

## Process

1. **Housekeeping, before selecting.** For each open issue labelled `agent:pr-open`, run `prs_for_issue N`:
   - Any PR is `MERGED`: close the issue (`gh issue close N --comment "Implemented in #P."`).
   - Any PR is `OPEN`: leave it alone.
   - Every PR is `CLOSED` (none open or merged): the work was abandoned. In one command swap `agent:pr-open` for `ready-for-human`, and comment "PR #P was closed without merging. A human should decide whether to retry." Do not send it back to an agent: that is how the same fix gets re-attempted in a loop.
   - No PR found at all: leave it alone and note it under **Problems** in the log.

   This is the only place this workflow changes the state of an issue it has not claimed.
2. **List candidates.**

   ```bash
   gh issue list --state open --limit 200 --json number,url,title,createdAt,labels --jq '
     def names: [.labels[].name];
     [ .[] | select((names | map(IN("agent:log","agent:stuck","agent:pr-open","needs-info","ready-for-agent","ready-for-human")) | any) | not)
           | {number, url, title, createdAt, labels: names} ] | sort_by(.createdAt)'
   ```

3. **Select.** Oldest first, apply `triage-github-issue`'s **Eligibility** (including the lease check) to each, and keep the first `$GROOM_BATCH` that pass.
4. **Dispatch** each selected issue to `triage-github-issue` by its `url` (see **Dispatching** in the protocol). Collect each result line.
5. **Log it.** One run-log entry (`references/log.md`): the counts, each item's result, and any **Problems**. Nothing eligible: log `nothing eligible` and stop.

## Never

- Triage an issue yourself, or change code or PRs.
- Claim an issue. Only `triage-github-issue` claims.
- Change the state of an issue other than the housekeeping above.
