---
name: setup-github-agent-workflow
description: Configure a repository for the GitHub agent workflow skills
disable-model-invocation: true
---

# Set up the GitHub workflow

Run once per repository, by a maintainer, before any other skill in this package. It checks the skills this package needs, creates the labels the workflow uses, and records the repository's settings in its own agent instructions. A human is present, so ask questions one at a time and show the default for each.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read `references/labels.md` in that skill's directory.

## Inputs

**Free text.** Anything the maintainer says. This skill is interactive, so treat every answer as the next input.

**Key-value pairs.** `key=value` on a line of its own. Recognised keys, all optional: `pr_base_branch` (default `main`), `app_url` (default none), `merge_method` (default `squash`), `human_reviewer` (default none), `build_cmd` (default none), `git_hooks_path` (default none) and `repo_guidance` (default `AGENTS.md`).

**Implicit dependencies.** There is **no config file**. The skills' defaults are the source of truth (see **Defaults** in `agent-workflow-protocol`), so this skill has nothing to install or wire up for a value. It does still need `gh` (authenticated), `jq` and Python 3 for the checks below, and it needs the skills themselves to be installed before the runs start.

## Process

1. **Check the tools.** `gh auth status` must succeed, and `jq` and `python3` must exist (the helpers use Python for date arithmetic). Run `gh repo view --json nameWithOwner` and confirm with the user that this is the repository to set up.
2. **Check the skills this package needs from elsewhere.** Look through your available skills for `tdd` and `code-review`. They come from [mattpocock/skills](https://github.com/mattpocock/skills), and the workflow calls them. A repository's own `code-review` skill also satisfies the second. For anything missing, tell the user how to install it, then continue:
   - Claude Code: `claude plugins install matt-pocock-skills`
   - Any agent: `npx skills@latest add mattpocock/skills` (and pick `tdd` and `code-review`)
3. **Ask for the repository's settings**, one question each, with the default shown. Every one of them is an input a skill already takes, so a value the user does not want to set stays at the skill's default and needs no file.
   - the branch agent PRs target (`pr_base_branch`, default `main`)
   - the URL of the deployed app that Exploring should browse (`app_url`), or none (Exploring then reads the code only)
   - the merge method (`merge_method`: squash, merge or rebase)
   - the GitHub user to request review from when an item is escalated (`human_reviewer`), or none
   - the build command to run before opening a PR (`build_cmd`), or none (CI is then the only build gate)
   - a git hooks directory to use when committing (`git_hooks_path`), or none
   - the files that hold the repository's contributor rules (`repo_guidance`, default `AGENTS.md`). Offer `CLAUDE.md` if that is what exists.
4. **Write the settings where the runner will read them.** There is no settings file to write. Put the values the user gave into the repository's agent instructions, so the scheduler prompt can pass them: edit `CLAUDE.md` if it exists, otherwise `AGENTS.md`, and never create the second when the first exists. Add (or update) a short `## GitHub workflow` section that lists each setting as the key-value input it is, for example `pr_base_branch: develop`, and names the group skills (`/explore-github-repo`, `/triage-github-issues`, `/implement-github-issues`, `/shepherd-github-prs`, `/review-github-prs`). Show it and get a yes before writing.
5. **Create the labels.** Run the setup block in `references/labels.md`. It is safe to run twice.
6. **Check it works.** Run `gh label list` and confirm the `agent:` labels are there.
7. **Tell the user how to start.** Give them the one-line prompts to put in a scheduler, one per automation, with the repository filled in and the settings from step 4 added as key-value inputs:

   | Step | Prompt |
   |---|---|
   | Exploring | `Run /explore-github-repo on github.com/OWNER/REPO. app_url: https://...` |
   | Grooming | `Run /triage-github-issues on github.com/OWNER/REPO` |
   | Implementing | `Run /implement-github-issues on github.com/OWNER/REPO. pr_base_branch: develop` |
   | Shepherding | `Run /shepherd-github-prs on github.com/OWNER/REPO` |
   | Reviewing | `Run /review-github-prs on github.com/OWNER/REPO. merge_method: squash` |

   Suggest running each once by hand and reading the run-log comment for **Problems** before scheduling anything. Reviewing merges PRs, so a sandbox repository is the safest place to start.

## Never

- Write a settings file. The skills' defaults are the source of truth, and a repository's values belong in the prompt or the agent instructions.
- Change anything outside the repository's agent instructions, the label set, and the pointer in step 4.
- Overwrite an existing section without showing the change first.
