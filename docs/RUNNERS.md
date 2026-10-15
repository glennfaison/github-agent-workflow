# Runners

What a scheduler needs to run this package, and how to word its prompts.

## What a runner needs

| Capability | Shell runner | No-shell runner (chat automation + GitHub connector) |
|---|---|---|
| Loads skills from this package | Yes | Yes (or reads each `SKILL.md` by name) |
| Runs `scripts/lib.sh`, `gh`, `git`, `npm` | Yes | No. Follow [Running without a shell](../skills/meta/agent-workflow-protocol/SKILL.md) and the pure-JS reference in `skills/meta/agent-workflow-protocol/scripts/helpers.mjs` |
| Writes issues, comments, labels, PRs | Yes | Yes |

## Copy-paste prompts

One block per skill: every input that skill takes, each with its default as the value, so a runner edits only what it cares about and deletes the rest. An empty line means *no default* — fill it in when the run needs it, leave it empty otherwise (`app_url=`, `build_cmd=`, `git_hooks_path=`, `human_reviewer=`, `run_id=`, `related=`, `screenshots=`). Fill in `OWNER/REPO` and `NAME` (the runner's name, so the run log says who did what) and each block is ready to paste.

Schedule the group skill of each step. Run an item skill by hand, with its issue or PR as a number or URL on the command line (or as `issue=N` / `pr=N` on a line of its own). The last line of every block is the unattended rule — drop it when a human is at the keyboard.

### Exploring

`explore-github-repo` browses the live app when `app_url` is set (the code only when it is not), ranks what it finds, and hands the best to `file-github-issues`.

```text
Run /explore-github-repo on github.com/OWNER/REPO
app_url=
issues_per_run=5
log_lookback_days=14
dry_run=false
runner=NAME
No human is present: do not ask questions.
```

`file-github-issues`, by hand, for one finding (a batch arrives as prose or as `candidates=`):

```text
Run /file-github-issues
title=<one-line title>
category=bug
area=<part of the product or code>
impact=<who it hurts and how much>
confidence=high
evidence=<what happened / expected, steps, severity — the required sections for its category>
related=
screenshots=
dry_run=false
dedupe_closed_days=30
run_id=
No human is present: do not ask questions.
```

### Grooming

```text
Run /triage-github-issues on github.com/OWNER/REPO
groom_batch=5
No human is present: do not ask questions.
```

`triage-github-issue`, by hand, for one issue:

```text
Run /triage-github-issue 123
lease_ttl_triage=1 hour
max_item_failures=3
dedupe_closed_days=30
No human is present: do not ask questions.
```

### Implementing

```text
Run /implement-github-issues on github.com/OWNER/REPO
implement_batch=1
No human is present: do not ask questions.
```

`implement-github-issue`, by hand:

```text
Run /implement-github-issue 123
lease_ttl_implement=3 hours
max_item_failures=3
pr_base_branch=main
build_cmd=
git_hooks_path=
repo_guidance=AGENTS.md
No human is present: do not ask questions.
```

### Shepherding

```text
Run /shepherd-github-prs on github.com/OWNER/REPO
shepherd_batch=3
No human is present: do not ask questions.
```

`shepherd-github-pr`, by hand:

```text
Run /shepherd-github-pr 45
lease_ttl_pr=1 hour
max_shepherd_attempts=3
max_item_failures=3
human_reviewer=
git_hooks_path=
repo_guidance=AGENTS.md
No human is present: do not ask questions.
```

### Reviewing

```text
Run /review-github-prs on github.com/OWNER/REPO
review_batch=3
No human is present: do not ask questions.
```

`review-github-pr`, by hand:

```text
Run /review-github-pr 45
lease_ttl_pr=1 hour
max_review_rounds=3
max_item_failures=3
pr_base_branch=main
merge_method=squash
human_reviewer=
git_hooks_path=
No human is present: do not ask questions.
```

### One-time setup

```text
Run /setup-github-agent-workflow on github.com/OWNER/REPO
```
