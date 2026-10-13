# Runners

What a scheduler needs to run this package, and how to word its prompts.

## What a runner needs

| Capability | Shell runner | No-shell runner (chat automation + GitHub connector) |
|---|---|---|
| Loads skills from this package | Yes | Yes (or reads each `SKILL.md` by name) |
| Runs `scripts/lib.sh`, `gh`, `git`, `npm` | Yes | No. The protocol's [Running without a shell](../skills/meta/agent-workflow-protocol/SKILL.md) applies |
| Writes issues, comments, labels, PRs | Yes | Yes |

## Prompt shape

A one-line prompt is enough:

> Run /explore-github-repo on github.com/OWNER/REPO
> app_url=https://staging.example.com
> issues_per_run=3
> log_lookback_days=14
> No human is present: do not ask questions.
> Runner: NAME

Use any group skill (`triage-github-issues`, `implement-github-issues`, `shepherd-github-prs`, `review-github-prs`) the same way. Item skills take an issue or PR number or URL.

## Inputs

The canonical lists are the skills' own **Inputs** sections and the **Defaults** table in [agent-workflow-protocol](../skills/meta/agent-workflow-protocol/SKILL.md). The inputs with no default (`app_url`, `human_reviewer`, `build_cmd`, `git_hooks_path`) are shown empty, which is their default. Fill in `OWNER/REPO` and `NAME` (the runner's name, so the run log says who did what) and each block is ready to paste.

BUCKET is "utility" for merge-safety, unattended-triage and grill-via-github-comments, otherwise "pipeline" or "meta".

## Cadence (starting point)

- Exploring: a few times a week
- Grooming: daily
- Implementing: as capacity allows
- Shepherding / Reviewing: often enough that CI and review do not stall

Adjust to the repository. Skills never depend on the schedule; they select by labels and comments only.
