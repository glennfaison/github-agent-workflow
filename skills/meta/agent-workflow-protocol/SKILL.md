---
name: agent-workflow-protocol
description: Shared rules for the GitHub issue-to-merge agent workflow (leases, markers, labels, handoffs, escalation, run log, and running unattended or without a shell). Read it before using any explore-, triage-, implement-, shepherd- or review-github skill. It is reference material, not something to run on its own.
---

# GitHub workflow protocol

Shared by every skill in this package. Each of them points here first. Read this file once per run, then the reference files it names when a skill tells you to.

## The skills

| Step | Group skill (selects and dispatches) | Item skill (works on one item) |
|---|---|---|
| Exploring | `explore-github-repo` | `file-github-issues` |
| Grooming | `triage-github-issues` | `triage-github-issue` |
| Implementing | `implement-github-issues` | `implement-github-issue` |
| Shepherding | `shepherd-github-prs` | `shepherd-github-pr` |
| Reviewing | `review-github-prs` | `review-github-pr` |

Item skills lean on three **utility skills**: `unattended-triage`, `grill-via-github-comments`, and `merge-safety`. `setup-github-agent-workflow` is run once per repository, by a human.

## Defaults

| Name | Default | Where it is used |
|---|---|---|
| `app_url` | *(none)* | `explore-github-repo` |
| `issues_per_run` | `5` | `explore-github-repo` |
| `log_lookback_days` | `14` | `explore-github-repo` |
| `dedupe_closed_days` | `30` | `file-github-issues`, `triage-github-issue` |
| `pr_base_branch` | `main` | `implement-github-issue`, `review-github-pr` |
| `merge_method` | `squash` | `review-github-pr` |
| `human_reviewer` | *(none)* | `shepherd-github-pr`, `review-github-pr` |
| `build_cmd` | *(none)* | `implement-github-issue` |
| `git_hooks_path` | *(none)* | `implement-github-issue`, `shepherd-github-pr`, `review-github-pr` |
| `repo_guidance` | `AGENTS.md` | `implement-github-issue`, `shepherd-github-pr` |
| `lease_ttl_triage` | `1 hour` | `triage-github-issue` |
| `lease_ttl_implement` | `3 hours` | `implement-github-issue` |
| `lease_ttl_pr` | `1 hour` | `shepherd-github-pr`, `review-github-pr` |
| `groom_batch` | `5` | `triage-github-issues` |
| `implement_batch` | `1` | `implement-github-issues` |
| `shepherd_batch` | `3` | `shepherd-github-prs` |
| `review_batch` | `3` | `review-github-prs` |
| `max_shepherd_attempts` | `3` | `shepherd-github-pr` |
| `max_review_rounds` | `3` | `review-github-pr` |
| `max_item_failures` | `3` | item skills |

## Unattended runs

- **No human is present, and nobody answers questions.** Do not stop to ask.
- **If you cannot do something a skill requires, do not improvise.** Record it under **Problems** in the run log, release any lease you hold, and move on.

## Shell setup

```bash
source <this skill's directory>/scripts/lib.sh
```

Requires `gh` (authenticated), `jq` and Node.js. Without a shell, see the next section.

## Running without a shell

Explicit fallback when `scripts/lib.sh`, `gh`, or a local clone are unavailable.

1. **Helpers and `gh`/`git` commands say *what* to do, not how.** Perform the same operations with GitHub MCP / connector tools (`search_issues`, `issue_read`, `issue_write`, `add_issue_comment`, label edit, etc.) and any browser tools you have.
2. **RUN_ID.** Use UTC `YYYYMMDDTHHMMSSZ` plus `-` and the runner name (sanitize non-alphanumeric to `-`). Example: `20261015T134700Z-grok`. The pure-JS helper `makeRunId(runner)` in `scripts/helpers.mjs` produces this format.
3. **Dates.** Prefer the formulas in `scripts/helpers.mjs` (`utcPlus`, `utcEpoch`) — same Node logic `lib.sh` already uses. No Python.
4. **Log and markers.** Copy the comment shapes from `formatLogComment`, `leaseComment`, and `failureComment` in `helpers.mjs`. Post them with `add_issue_comment`. Find or create the `agent:log` / `agent:difficulty` issues the same way `log_issue` / `difficulty_issue` do.
5. **Where a skill says to check out a branch and push,** commit through your tools instead.
6. **If a required tool is missing,** record under **Problems** (tag `degraded:` or `repo-state:`) and move on. Do not improvise destructive actions.

`scripts/helpers.mjs` is the reference implementation for no-shell runners. It is not executed by the shell path; `lib.sh` remains the shell entry point.

## Inputs

This skill is reference material: it takes **no inputs** of its own.

## References

| File | Holds |
|---|---|
| `references/labels.md` | labels including `agent:log` and `agent:difficulty` |
| `references/handoff.md` | ready and review handoff comments |
| `references/escalate.md` | when and how to give an item to a human |
| `references/dedupe.md` | duplicate search and canonical-issue rule |
| `references/issue-format.md` | well-formed issue contents |
| `references/log.md` | run log, difficulty issues, YAML header, 2-week retention |
| `scripts/lib.sh` | shell helpers (Node.js date math; no Python) |
| `scripts/helpers.mjs` | pure-JS reference for no-shell runners (RUN_ID, dates, lease/log comment shapes) |

## Helpers

`markers`, `prs_for_issue`, `issue_for_pr`, `review_rounds`, `shepherd_attempts`, `fail_item`, `failures`, `open_findings`, `ready_sha`, `log_issue`, `log_run`, `difficulty_issue`, `read_logs` — implemented in `scripts/lib.sh` when a shell is available.

Without a shell, perform the same operations with GitHub MCP/connector tools. Use `scripts/helpers.mjs` for deterministic `RUN_ID`, date math, lease/failure markers, and the log-comment YAML + prose skeleton so every runner writes the same shapes.
