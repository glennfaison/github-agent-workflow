# GitHub Agent Workflow Skills

Agent skills that run a GitHub repository's issue-to-merge pipeline with nobody at the keyboard. Point a scheduler at one skill per step, and issues flow from "found" to "merged":

```
explore ──► triage ──► implement ──► shepherd ──► review ──► merged
 files        sorts       opens a      gets it       reviews and
 issues       issues      PR           through CI    merges when safe
```

The steps never call each other. They coordinate through GitHub itself: labels, hidden marker comments and a lease on each item, so any step can run at any time, on any schedule, and two runs cannot trip over the same item.

Each step is a pair of skills. A **group skill** selects the work (`/triage-github-issues` looks at every open issue). An **item skill** does the work on one item (`/triage-github-issue 123`). The group skill dispatches to the item skill, so you can also run the item skill by hand on a single issue or PR.

## Quickstart

1. **Install** the skills and their dependencies (see [Install](#install)).
2. **Set up the repository.** In an agent, run `/setup-github-agent-workflow`. It checks the dependencies, asks for the repository's settings, records them in the repository's agent instructions, and creates the labels.
3. **Try each step once by hand**, and read the run-log comment it leaves (a monthly `Agent log` issue). Reviewing merges PRs, so use a sandbox repository first.
4. **Schedule** one prompt per step on your runner:

   | Step | Prompt |
   |---|---|
   | Exploring | `Run /explore-github-repo on github.com/OWNER/REPO` |
   | Grooming | `Run /triage-github-issues on github.com/OWNER/REPO` |
   | Implementing | `Run /implement-github-issues on github.com/OWNER/REPO` |
   | Shepherding | `Run /shepherd-github-prs on github.com/OWNER/REPO` |
   | Reviewing | `Run /review-github-prs on github.com/OWNER/REPO` |

   The runner owns timing, frequency and triggers (a schedule, a webhook). The skills own what a run does. Add the repository's settings as key-value inputs on the prompt (see [Inputs and defaults](#inputs-and-defaults)); Exploring browses the live app when one is given. [docs/RUNNERS.md](./docs/RUNNERS.md) covers what a runner needs, prompts for runners that cannot load skills, and a starting cadence.

## Skills

### GitHub workflow ([skills/pipeline](./skills/pipeline/README.md))

- **[pipeline-guide](./skills/pipeline/pipeline-guide/SKILL.md)**: Map of the steps and which skill to run. Read-only index.
- **[agent-workflow-protocol](./skills/pipeline/agent-workflow-protocol/SKILL.md)**: Leases, markers, labels, handoffs, escalation, the run log and the config. Every other skill reads it first.
- **[setup-github-agent-workflow](./skills/pipeline/setup-github-agent-workflow/SKILL.md)**: Configure a repository for the workflow. User-invoked. Run once per repo.
- **[explore-github-repo](./skills/pipeline/explore-github-repo/SKILL.md)**: Explore the live app and the code, rank findings, and file the best as issues.
- **[file-github-issue](./skills/pipeline/file-github-issue/SKILL.md)**: File one finding as an issue after a duplicate check.
- **[triage-github-issues](./skills/pipeline/triage-github-issues/SKILL.md)**: Scan the open issues and dispatch the ones that need triage.
- **[triage-github-issue](./skills/pipeline/triage-github-issue/SKILL.md)**: Triage one issue to `ready-for-agent`, `ready-for-human` or `needs-info`.
- **[implement-github-issues](./skills/pipeline/implement-github-issues/SKILL.md)**: Pick the `ready-for-agent` issues and dispatch them.
- **[implement-github-issue](./skills/pipeline/implement-github-issue/SKILL.md)**: Implement one issue and open a PR.
- **[shepherd-github-prs](./skills/pipeline/shepherd-github-prs/SKILL.md)**: Pick the PRs that need work and have finished their checks, and dispatch them.
- **[shepherd-github-pr](./skills/pipeline/shepherd-github-pr/SKILL.md)**: Get one PR through checks and post the review handoff.
- **[review-github-prs](./skills/pipeline/review-github-prs/SKILL.md)**: Pick the PRs ready for review and dispatch them.
- **[review-github-pr](./skills/pipeline/review-github-pr/SKILL.md)**: Review one PR and merge it, pinned to the reviewed commit, when it is safe.

### Utility ([skills/utility](./skills/utility/README.md))

- **[unattended-triage](./skills/utility/unattended-triage/SKILL.md)**: Decide an issue's state and write the outcome comment. Adapted from `triage`.
- **[unattended-grilling](./skills/utility/unattended-grilling/SKILL.md)**: Ask the whole ready frontier of questions in one round, each with a recommended answer. Adapted from `grilling`.
- **[merge-safety](./skills/utility/merge-safety/SKILL.md)**: Assess whether a PR is safe for an agent to merge on its own.

## Requirements

- An agent that supports skills (Claude Code, Kilo Code, Codex, ...), or one that can read a `SKILL.md` and follow it.
- `gh` (authenticated, with repository write access), `jq` and Python 3 for the shell helpers. Runners with no shell (a chat automation with a GitHub connector) work too: the protocol tells the agent to do the same operations with the tools it has, and to log what it cannot do.
- Two skills from [mattpocock/skills](https://github.com/mattpocock/skills):
  - `tdd`, used to build test-first.
  - `code-review`, used before opening a PR and when reviewing one. A repository's own `code-review` skill satisfies it.

  The plugin declares this dependency for Claude Code. Everywhere else, install it yourself. [external-skills.json](./external-skills.json) is the machine-readable list.

## Install

**Claude Code (plugin).** Add this repository as a marketplace, then install `github-agent-workflow`. The `mattpocock-skills` dependency is installed with it, from the `claude-plugins-official` marketplace.

**Any agent (copy).** Use the skills CLI to copy the skills into your skills directory, which flattens them:

```bash
npx skills@latest add <owner>/<repo>
npx skills@latest add mattpocock/skills      # tdd and code-review
```

**Vendored (folder or submodule).** Put this repository at `.agents/skills/github-agent-workflow` (a plain folder or `git submodule add`), then link the skills into the directory above it so agents that look one level deep can find them:

```bash
.agents/skills/github-agent-workflow/scripts/link-skills.sh
```

Commit the links. Run the script again after updating the package.

## Inputs and defaults

Every skill takes its inputs two ways, mixed freely in one prompt:

- **Key-value pairs**, `key=value` on a line of its own, for example `app_url=https://staging.example.com` or `issue=123`.
- **Free text**, which each skill knows how to read: a URL or a bare number on its own, a sentence describing what you want done.

**There is no config file.** Each skill has an `## Inputs` section listing everything it takes, including its **implicit dependencies** (the tools, skills and repository state it needs that are not inputs), and stating the **default** for every value where one is sensible. `agent-workflow-protocol` collects the shared defaults:

| Input | Default |
|---|---|
| `app_url` | *(none)* |
| `issues_per_run` | `5` |
| `log_lookback_days` | `14` |
| `dedupe_closed_days` | `30` |
| `pr_base_branch` | `main` |
| `merge_method` | `squash` |
| `human_reviewer` | *(none)* |
| `build_cmd` | *(none)* |
| `git_hooks_path` | *(none)* |
| `repo_guidance` | `AGENTS.md` |
| `lease_ttl_triage` | `1 hour` |
| `lease_ttl_implement` | `3 hours` |
| `lease_ttl_pr` | `1 hour` |
| `groom_batch` | `5` |
| `implement_batch` | `1` |
| `shepherd_batch` | `3` |
| `review_batch` | `3` |
| `max_shepherd_attempts` | `3` |
| `max_review_rounds` | `3` |
| `max_item_failures` | `3` |

Leave an input out and its default applies, so a repository that suits the defaults needs no settings at all. For a runner with a shell, `scripts/lib.sh` implements the same defaults and honours an exported override.

## Layout

```
.claude-plugin/        plugin.json (skills, dependencies) and marketplace.json
skills/
  pipeline/            the pipeline: group and item skills, the protocol, setup
  utility/             building blocks the pipeline calls
scripts/               link-skills.sh, validate-skills.mjs, sync-plugin-version.mjs
tests/                 the shell helpers, against a stub gh
docs/RUNNERS.md        running the steps on a scheduler
docs/adr/              decisions
external-skills.json   skills needed from elsewhere
```

## Development

```bash
npm install
npm run validate               # structure, front matter, references, manifest, READMEs, inputs
npm test                       # the shell helpers, against a stub gh
npm run check-plugin-version
```

See [AGENTS.md](./AGENTS.md) for the conventions, and [docs/adr](./docs/adr) for why the package is built this way.

## Credits and licence

Parts of the triage, grilling and implementation skills are adapted from [mattpocock/skills](https://github.com/mattpocock/skills). See [CREDITS.md](./CREDITS.md). Released under the [MIT License](./LICENSE).
