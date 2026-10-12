# Running the workflow on a scheduler

The skills decide what a run does. The runner (a scheduler, a webhook, a cloud agent, a chat automation) decides when it starts and what it can reach. This page covers what a runner needs and how to write its prompt.

## What a run needs

| Need | Why |
|---|---|
| The repository, checked out and authenticated as `gh` | A group skill lists the repository's issues and PRs. Export a `GH_TOKEN` the skills can use |
| The repository checked out, **with submodules** if the skills are vendored as one | A vendored package that is not initialised leaves the skill links dangling, and the run fails with "skill not found" |
| `gh` authenticated as a bot or maintainer, plus `jq` and Python 3 | The shell helpers |
| A token that can write | Typically: Contents, Issues and Pull requests read and write; Actions read (for `gh run view --log-failed`); Metadata read |
| `tdd` and `code-review` | Used by Implementing, Shepherding and Reviewing. See [Requirements](../README.md#requirements) |
| The repository's build dependencies | Only when `build_cmd` is set or a skill runs tests |
| A git identity (`user.name`, `user.email`) | Implementing and Shepherding commit |
| The repository's settings, as key-value inputs | Only the ones that differ from the defaults in [Inputs and defaults](../README.md#inputs-and-defaults) |

Branch protection applies to the token like to anyone. If it may not merge, Reviewing records `failed` and moves on. It does not retry in the same run.

## Two kinds of runner

| | Agent with a shell (Claude Code, Kilo Cloud Agent or CLI, Codex, a CLI agent on a cron) | Chat automation with a GitHub connector (no shell) |
|---|---|---|
| Runs `scripts/lib.sh`, `gh`, `git`, `npm` | Yes | No. The protocol's [Running without a shell](../skills/pipeline/agent-workflow-protocol/SKILL.md) applies |
| Exploring, Grooming | Yes | Yes, if the connector can comment and label issues |
| Implementing | Yes | Only small changes: it cannot run tests, so it bails out of anything larger |
| Shepherding | Yes | Rarely: it needs the failing check logs |
| Reviewing | Yes | Only if the connector can pin a merge to the reviewed commit |

Start a chat automation with Exploring and Grooming. Give Implementing, Shepherding and Reviewing to a runner with a shell.

## Writing the prompt

Every prompt is one instruction plus the runner's name, so the run log says who did what.

**Runner loads skills by name:**

```
Run /triage-github-issues on github.com/OWNER/REPO.
No human is present: do not ask questions. Runner: NAME.
```

Add "If the slash command is not recognised, call the Skill tool with `triage-github-issues`, or read its `SKILL.md` and follow it." for harnesses that treat `/name` as a command only.

**Pass a repository setting that differs from a default.** Add it as a key-value pair on its own line. Nothing is required: each skill falls back to its own default, listed in [Inputs and defaults](../README.md#inputs-and-defaults). Only what the repository genuinely differs on is worth adding:

```
Run /implement-github-issues on github.com/OWNER/REPO. pr_base_branch=develop.
No human is present: do not ask questions. Runner: NAME.
```

**Runner cannot load skills (chat automation):** point at the files and say how to read them.

```
You are running unattended: no human will answer questions. Runner: NAME.
Repository: OWNER/REPO.
Read https://github.com/PKG_OWNER/github-agent-workflow/blob/REF/skills/pipeline/triage-github-issues/SKILL.md and follow it.
Where a skill says "Call the Skill tool with X", read X's SKILL.md at
https://github.com/PKG_OWNER/github-agent-workflow/blob/REF/skills/BUCKET/X/SKILL.md and follow it.
BUCKET is "utility" for merge-safety, unattended-triage and unattended-grilling, otherwise "pipeline".
You have no shell: follow "Running without a shell" in agent-workflow-protocol.
Read the repository's settings from its agent instructions, and pass the ones you were given as
key-value inputs (see [Inputs and defaults](../README.md#inputs-and-defaults)).
```

Pin `REF` to a commit or tag, not a branch. The run executes whatever that file says, and a merge is one of the things it can do.

For a vendored package the skill files are not in the application repository, only a pointer to them, so a connector reading the application repository finds nothing. Point it at the package repository.

## When to run each step

The steps never call each other and never wait on each other, so any order works. A starting point:

| Step | Cadence | Notes |
|---|---|---|
| Exploring | Weekly | Files at most `issues_per_run` issues per run. |
| Grooming | Every 1 to 2 hours | Takes at most `groom_batch` issues. |
| Implementing | Every 3 hours | `implement_batch` is 1: each run implements one issue. A run that is still working holds a lease for `lease_ttl_implement`, so a later run skips that issue instead of duplicating it. |
| Shepherding | Every 30 to 60 minutes | Skips PRs whose checks are still running. |
| Reviewing | Every 30 to 60 minutes | Merges. Start it on a sandbox repository. |

Offset the start minutes so runs do not begin together. Every run appends a comment to the monthly log issue, even when nothing was eligible, so short intervals fill it quickly. Prefer the longer intervals unless the backlog moves fast.

## First run

1. Run `/setup-github-agent-workflow` once by hand.
2. Run each step by hand on the repository. Read the run-log comment (the monthly `Agent log` issue) for **Problems**.
3. Schedule Exploring and Grooming. Add Implementing and Shepherding when their output looks right. Add Reviewing last.

To stop everything for one item, label it `agent:stuck`. To stop a step, pause its automation.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "skill not found" | Submodules not initialised, or `scripts/link-skills.sh` not run after an update |
| Every run logs `nothing eligible` | Nothing carries the input label yet. Normal on a new repository |
| `failed: cannot read failing output` | The token lacks Actions read, or the runner has no log access |
| Exploring files nothing from the live app | No `app_url` input and no URL in the prompt, or the runner cannot browse. The log says which |
| An item stays leased | The run died. The lease expires after its TTL and the next run takes it |
| An item carries `agent:stuck` after repeated `failed` results | The same step failed on it `max_item_failures` times. The escalation comment lists the reasons. Fix the cause and remove the label |
