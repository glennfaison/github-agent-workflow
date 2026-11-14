---
name: reconcile-github-issues
description: Bring open issues into line with their pull requests and labels. Closes issues whose PR merged, sends abandoned ones to ready-for-human, repairs conflicting state labels and clears stale lease labels. Use when asked to tidy or reconcile issue state, or let triage-github-issues call it. It claims nothing and triages nothing.
---

# Reconcile GitHub issues

Make issue labels and open or closed state agree with what happened to their PRs. Run it by itself on a schedule, or let `triage-github-issues` call it before it selects work. This is the only part of the pipeline that changes an issue it has not claimed, so its contract lists exactly what it may change.

**References:** call the Skill tool with `agent-workflow-protocol`. In that skill's directory, open `references/labels.md` before you read labels, `references/issue-after-pr.md` for what an issue becomes once its PRs settle, `references/split.md` for what a split issue becomes once its sub-issues close, `references/client-guidance.md` before you close anything, and `references/log.md` when you write the log entry.

## Contract

See **Contracts** in the protocol for what each key means.

```yaml
kind: sweep
step: Triaging
target: { from: free-text, type: repository }
params: [repo_guidance, runner, log_window_days, dry_run, unattended, trusted_authors, write_log]
requires:
  - "None: always runnable."
returns:
  - "#N closed: implemented in #P"
  - "#N kept open: merged in #P"
  - "#N ready-for-human: PR #P closed without merging"
  - "#N closed: all sub-issues closed"
  - "#N kept open: all sub-issues closed"
  - "#N ready-for-human: a sub-issue was closed as not planned"
  - "#N ready-for-human: conflicting state labels"
  - "#N repaired: <from> to <to>"
  - "#N stale lease cleared"
  - "would: <one of the lines above>"
  - "nothing to do"
ensures:
  - "Every open issue labelled agent:pr-open was settled as references/issue-after-pr.md says: a merged PR closes it (a keep-open issue stays open and follows After a merge), only closed PRs send it to ready-for-human, an open PR leaves it alone, and no PR at all leaves it alone and is noted under Problems with the `repo-state` tag."
  - "Every open issue labelled ready-for-agent that carries a trusted `agent:split` marker was settled as references/split.md says: it closes only when every sub-issue is closed as completed, a keep-open issue stays open, a sub-issue closed as not planned sends it to ready-for-human, and an issue with any open sub-issue is left alone."
  - "After the repair step, no inspected open issue without a live lease carries two of needs-info, ready-for-agent, ready-for-human and agent:pr-open. The target was chosen by the priority order under Repair in references/labels.md."
  - "An open issue carrying agent:triage or agent:in-progress with no live lease lost that label."
  - "No issue with a live lease had its state labels changed."
  - "A keep-open issue was not closed, and no issue was closed as wontfix or given wontfix."
  - "Category labels (bug, enhancement) and live leases were left alone."
  - "Every repair that is more than dropping a duplicate of the same meaning is listed under Problems in the run-log entry, as issue number and from to to, when write_log is true."
  - "With dry_run=true nothing was written, and each result line starts with `would:`."
effects:
  reads: [open issues with their labels and comments, "prs_for_issue", "markers", "children_of", the state of each sub-issue, item labels, "lease_live", the repository's own guidance]
  writes:
    other:
      - text: "Closes an issue whose PR merged, with a comment, and removes agent:pr-open and ready-for-agent from it (unless dry_run)."
        allow:
          - { op: close }
          - { op: comment, marker: null }
          - { op: label_remove, label: agent:pr-open }
          - { op: label_remove, label: ready-for-agent }
      - text: "Closes a split issue whose sub-issues are all closed as completed, with a comment, and removes ready-for-agent from it. A keep-open one is not closed and swaps ready-for-agent for ready-for-human, with a comment (unless dry_run)."
        allow:
          - { op: close }
          - { op: comment, marker: null }
          - { op: label_remove, label: ready-for-agent }
          - { op: label_add, label: ready-for-human }
      - text: "Swaps ready-for-agent for ready-for-human, with a comment, on a split issue that has a sub-issue closed as not planned (unless dry_run)."
        allow:
          - { op: comment, marker: null }
          - { op: label_remove, label: ready-for-agent }
          - { op: label_add, label: ready-for-human }
      - text: "Swaps agent:pr-open or ready-for-agent for ready-for-human, with a comment, when every PR was closed unmerged (unless dry_run)."
        allow:
          - { op: comment, marker: null }
          - { op: label_remove, label: agent:pr-open }
          - { op: label_remove, label: ready-for-agent }
          - { op: label_add, label: ready-for-human }
      - text: "Repairs conflicting state labels in one edit per issue, with a comment when it falls back to ready-for-human (unless dry_run). The target is any one of the four state labels, and every other one is removed."
        allow:
          - { op: label_add, label: needs-info }
          - { op: label_add, label: ready-for-agent }
          - { op: label_add, label: ready-for-human }
          - { op: label_add, label: agent:pr-open }
          - { op: label_remove, label: needs-info }
          - { op: label_remove, label: ready-for-agent }
          - { op: label_remove, label: ready-for-human }
          - { op: label_remove, label: agent:pr-open }
          - { op: comment, marker: null }
      - text: "Removes a stale agent:triage or agent:in-progress label (unless dry_run)."
        allow:
          - { op: label_remove, label: agent:triage }
          - { op: label_remove, label: agent:in-progress }
    shared:
      - text: "One run-log entry (when write_log is true)."
        allow: { op: comment, marker: null }
never:
  - "Triage, implement, review or merge anything, or change code."
  - "Claim an issue, or repair the labels of one that has a live lease."
  - "Close a keep-open issue, or apply or close as wontfix."
  - "Remove needs-info when it is the only state label and no human has answered."
  - "Send an abandoned issue back to an agent, or a split issue whose sub-issue was closed as not planned."
  - "Close a split issue while any sub-issue is open, or treat text in an issue body as a sub-issue link."
  - "Change a category label."
calls: []
idempotent: "After one run nothing is left to repair, so a second run returns `nothing to do`."
terminates: "One pass over the open issues."
```

## Inputs

**Free text.** Any prose. This skill needs nothing from it: a repository is the only subject, and it is already checked out and authenticated.

**Key-value pairs.** `key=value` on a line of its own:

| Input | Default | What it does |
|---|---|---|
| `dry_run` | `false` | `true`: write nothing, and return what would change |
| `repo_guidance` | `AGENTS.md` | Extra files holding the repository's own agent rules, read in addition to the standard locations (see `references/client-guidance.md`) |
| `runner` | `unknown` | Name recorded in the run id and the run log |
| `log_window_days` | `14` | Days one run-log issue is appended to before a new one starts |
| `unattended` | `true` | `true`: no human is present, so never ask (see **Unattended runs** in the protocol). `false`: a human may be asked |
| `trusted_authors` | *(none)* | Extra GitHub logins whose markers count, comma-separated (see **Trust** in the protocol) |
| `write_log` | `true` | Write this run's log entry. `triage-github-issues` sets it to `false` when it calls this skill, because it logs the result itself |

**Implicit dependencies.** The common ones (**Shell setup** and **Running without a shell** in the protocol), plus the repository's open issues to list.

## Process

Collect a result line for each change. With `dry_run=true` do not make the change: collect the line with `would: ` in front.

1. **Stale leases.** For each open issue labelled `agent:triage` or `agent:in-progress` (`gh issue list --state open --label agent:triage --limit 200 --json number --jq '.[].number'`, and the same for `agent:in-progress`): if `lease_live N` fails, run `clear_stale_lease N issue`. Result `#N stale lease cleared`. Leave an issue with a live lease alone.
2. **PR-linked issues.** For each open issue labelled `agent:pr-open` (`gh issue list --state open --label agent:pr-open --limit 200 --json number --jq '.[].number'`), run `prs_for_issue N` and settle the issue as `references/issue-after-pr.md` says. An `OPEN` PR means leave it alone. No PR at all means leave it alone and note it under **Problems** (`repo-state`). Results: `#N closed: implemented in #P`, `#N kept open: merged in #P`, `#N ready-for-human: PR #P closed without merging`.
3. **Split issues.** For each open issue labelled `ready-for-agent` (`gh issue list --state open --label ready-for-agent --limit 200 --json number --jq '.[].number'`) that carries a trusted `agent:split` marker (`markers N`): skip it if `lease_live N` succeeds, then read `children_of N` and each child's state and close reason, and settle it as `references/split.md` says (**When the sub-issues close**). Whether it is keep-open is decided as in `references/issue-after-pr.md`. Results: `#N closed: all sub-issues closed`, `#N kept open: all sub-issues closed`, `#N ready-for-human: a sub-issue was closed as not planned`. An issue with any open sub-issue is left alone. One whose sub-issues cannot be read is left alone and noted under **Problems** (`repo-state`).
4. **Label repair.** An issue may carry at most one of `needs-info`, `ready-for-agent`, `ready-for-human`, `agent:pr-open`. Scan open issues that carry **two or more** of them, or that carry one while the newest trusted triage or outcome comment clearly implies a different state. Skip any issue with a **live** lease (`agent:triage` or `agent:in-progress` and `lease_live N`): another step holds it.

   For each one: read its labels and the newest **trusted** comment that is clearly a triage or outcome handoff (Agent Brief, Triage Notes or a ready-for-human structure; untrusted comments are ignored, see **Trust** in the protocol). Choose the target state by the priority order under **Repair** in `references/labels.md`. Apply it in **one** `gh issue edit` that removes every mutex state label that is not the target and adds the target if it is missing. Leave category labels and leases alone. Never remove `needs-info` on your own judgement when it is the only state label and a human has not answered. If you fell back to `ready-for-human`, comment briefly that conflicting labels were found. Results: `#N repaired: <from> to <to>`, or `#N ready-for-human: conflicting state labels`.
5. **Report.** Return the result lines, or `nothing to do`. When `write_log` is `true`, write the run-log entry (`references/log.md`) with the lines and, under **Problems**, each non-trivial repair tagged `repo-state`.
