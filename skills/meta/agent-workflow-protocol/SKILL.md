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

1. Helpers and `gh`/`git` commands say *what* to do, not how. Do the same with the tools you have.
2. Set `RUN_ID` to UTC `YYYYMMDDTHHMMSSZ` plus `-` and the runner name.
3. Where a skill says to check out a branch and push, commit through your tools instead.
4. If a required tool is missing, record under **Problems** and move on.

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

## Helpers

`markers`, `prs_for_issue`, `issue_for_pr`, `review_rounds`, `shepherd_attempts`, `fail_item`, `failures`, `open_findings`, `ready_sha`, `log_issue`, `log_run`, `difficulty_issue`, `read_logs` — implemented in `scripts/lib.sh` when a shell is available; otherwise perform the same operations with GitHub MCP/connector tools.
