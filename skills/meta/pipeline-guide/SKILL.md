---
name: pipeline-guide
description: Map of the GitHub agent workflow steps and which skill to run for each. Read-only index. Start here when deciding which pipeline skill to invoke.
---

# Pipeline guide

Read-only map of the issue-to-merge pipeline. Use this to decide which skill to run.

## Inputs

**Free text.** Optional. Ignored; this skill is a read-only index.

**Key-value pairs.** None.

**Implicit dependencies.** None. This skill only describes the other skills in the package.

## Lifecycle

![Issue → merge lifecycle](./references/lifecycle.svg)

Plain-text summary of the same flow:

```
explore ──► triage ──► implement ──► shepherd ──► review ──► merged
 files        sorts       opens a      gets it       reviews and
 issues       issues      PR           through CI    merges when safe
```

| Stage | Writes on the issue / PR |
|---|---|
| Exploring | New **unlabeled** issues (or evidence comments). Never touches labels. |
| Grooming | Exactly one of `ready-for-agent`, `ready-for-human`, `needs-info`. Lease: `agent:triage`. |
| Implementing | Opens a PR; sets `agent:pr-open`. Lease: `agent:in-progress`. |
| Shepherding | CI/fixes; handoff `kind=ready`. Lease on the PR. |
| Reviewing | Merge (default squash); handoff `kind=merged`; close issue / clear `agent:pr-open`. |

Human and escalation paths: `needs-info`, `ready-for-human`, `agent:stuck` (after `max_item_failures`). Bookkeeping labels `agent:log` and `agent:difficulty` are ignored when selecting work.

Canonical label rules: `agent-workflow-protocol` → `references/labels.md`.

## Steps

| Step | Group skill (selects work) | Item skill (one item) |
|---|---|---|
| Exploring | `explore-github-repo` | `file-github-issues` |
| Grooming | `triage-github-issues` | `triage-github-issue` |
| Implementing | `implement-github-issues` | `implement-github-issue` |
| Shepherding | `shepherd-github-prs` | `shepherd-github-pr` |
| Reviewing | `review-github-prs` | `review-github-pr` |

## Shared

- `agent-workflow-protocol` — leases, markers, labels, handoffs, escalation, run log, defaults, degraded/no-shell path. Reference material every other skill reads when needed.
- `setup-github-agent-workflow` — one-time repository setup (user-invoked).

## Utility skills the pipeline uses

- `grill-via-github-comments` — one round of questions with recommended answers when nobody is live.
- `unattended-triage` — category + state decision and the outcome comment.
- `merge-safety` — whether a PR is safe for an agent to merge.

## How to run

Point a scheduler at a group skill per step, or run an item skill by hand with an issue/PR number or URL. Skills coordinate through GitHub labels and marker comments; they never call each other directly.

Edit only the values you care about. Empty values mean "no default / fill when needed". Replace `OWNER/REPO`, URLs, numbers, and `NAME` (runner name for the log).

If a `/skill-name` slash command is not recognised, call the Skill tool with that skill name, or read its `SKILL.md` and follow it.

### Exploring (group)

```text
Run /explore-github-repo on github.com/OWNER/REPO
app_url=
issues_per_run=5
log_lookback_days=14
dry_run=false
runner=NAME
No human is present: do not ask questions.
If /explore-github-repo is not recognised, call the Skill tool with explore-github-repo, or read its SKILL.md and follow it.
```

Example shape (replace the placeholders):

```text
Run /explore-github-repo on github.com/OWNER/REPO
app_url=https://staging.example.com
issues_per_run=3
log_lookback_days=14
dry_run=false
runner=NAME
No human is present: do not ask questions.
If /explore-github-repo is not recognised, call the Skill tool with explore-github-repo, or read its SKILL.md and follow it.
```

### File issues (item, from Exploring)

```text
Run /file-github-issues
title=<one-line title>
category=bug
area=<part of the product or code>
impact=<who it hurts and how much>
confidence=high
evidence=<required sections for this category>
related=
screenshots=
dry_run=false
dedupe_closed_days=30
run_id=
No human is present: do not ask questions.
If /file-github-issues is not recognised, call the Skill tool with file-github-issues, or read its SKILL.md and follow it.
```

### Grooming (group)

```text
Run /triage-github-issues on github.com/OWNER/REPO
groom_batch=5
runner=NAME
No human is present: do not ask questions.
If /triage-github-issues is not recognised, call the Skill tool with triage-github-issues, or read its SKILL.md and follow it.
```

### Triage one issue (item)

```text
Run /triage-github-issue 123
lease_ttl_triage=1 hour
max_item_failures=3
dedupe_closed_days=30
runner=NAME
No human is present: do not ask questions.
If /triage-github-issue is not recognised, call the Skill tool with triage-github-issue, or read its SKILL.md and follow it.
```

### Implementing (group)

```text
Run /implement-github-issues on github.com/OWNER/REPO
implement_batch=1
runner=NAME
No human is present: do not ask questions.
If /implement-github-issues is not recognised, call the Skill tool with implement-github-issues, or read its SKILL.md and follow it.
```

### Implement one issue (item)

```text
Run /implement-github-issue 123
pr_base_branch=main
build_cmd=
git_hooks_path=
repo_guidance=AGENTS.md
lease_ttl_implement=3 hours
max_item_failures=3
runner=NAME
No human is present: do not ask questions.
If /implement-github-issue is not recognised, call the Skill tool with implement-github-issue, or read its SKILL.md and follow it.
```

### Shepherding (group)

```text
Run /shepherd-github-prs on github.com/OWNER/REPO
shepherd_batch=3
runner=NAME
No human is present: do not ask questions.
If /shepherd-github-prs is not recognised, call the Skill tool with shepherd-github-prs, or read its SKILL.md and follow it.
```

### Shepherd one PR (item)

```text
Run /shepherd-github-pr 124
lease_ttl_pr=1 hour
max_shepherd_attempts=3
max_item_failures=3
human_reviewer=
repo_guidance=AGENTS.md
runner=NAME
No human is present: do not ask questions.
If /shepherd-github-pr is not recognised, call the Skill tool with shepherd-github-pr, or read its SKILL.md and follow it.
```

### Reviewing (group)

```text
Run /review-github-prs on github.com/OWNER/REPO
review_batch=3
runner=NAME
No human is present: do not ask questions.
If /review-github-prs is not recognised, call the Skill tool with review-github-prs, or read its SKILL.md and follow it.
```

### Review one PR (item)

```text
Run /review-github-pr 124
lease_ttl_pr=1 hour
max_review_rounds=3
max_item_failures=3
merge_method=squash
pr_base_branch=main
human_reviewer=
runner=NAME
No human is present: do not ask questions.
If /review-github-pr is not recognised, call the Skill tool with review-github-pr, or read its SKILL.md and follow it.
```

### One-time setup

```text
Run /setup-github-agent-workflow on github.com/OWNER/REPO
If /setup-github-agent-workflow is not recognised, call the Skill tool with setup-github-agent-workflow, or read its SKILL.md and follow it.
```

Canonical input lists and defaults live in each skill's **Inputs** section and in `agent-workflow-protocol`. The blocks above mirror those values for copy-paste.
