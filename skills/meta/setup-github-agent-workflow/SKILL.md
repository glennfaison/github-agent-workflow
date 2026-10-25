---
name: setup-github-agent-workflow
description: Configure a repository for the GitHub agent workflow once. Checks the tools and the external skills, records the repository's settings in its agent instructions, and creates the labels the pipeline needs. User-invoked. Run once per repository.
disable-model-invocation: true
---

# Set up the GitHub agent workflow

Run once per repository, by a maintainer, before any other skill in this package. A human is present, so ask questions one at a time and show the default for each.

## Inputs

**Free text.** Anything the maintainer says. This skill is interactive, so treat every answer as the next input.

**Key-value pairs.** `key=value` on a line of its own. Optional overrides for the shared defaults in `agent-workflow-protocol`: `pr_base_branch`, `app_url`, `merge_method`, `human_reviewer`, `human_merge_paths`, `build_cmd`, `git_hooks_path`, `repo_guidance`, `trusted_authors`.

**Implicit dependencies.** There is **no config file**: the skills' defaults are the source of truth, so this skill installs nothing for a value. It needs `gh` (authenticated), `jq` and Node.js for the checks below, write access to the repository, permission to create labels, and the rest of this package installed so the pipeline skills are available.

## Process

1. **Check the tools.** `gh auth status` must succeed, and `jq` and `node` must exist. Run `gh repo view --json nameWithOwner` and confirm with the user that this is the repository to set up.
2. **Check the skills this package needs from elsewhere.** Look through your available skills for `tdd` and `code-review`. They come from [mattpocock/skills](https://github.com/mattpocock/skills), pinned in `external-skills.json`, and the workflow calls them. A repository's own `code-review` skill also satisfies the second. For anything missing, tell the user how to install it (the commands are in `external-skills.json`), then continue.
3. **Ask for the repository's settings**, one question each, with the default shown. Every one is an input a skill already takes, so a value the user leaves alone stays at the skill's default and needs no file:
   - the branch agent PRs target (`pr_base_branch`, default `main`)
   - the URL of the deployed app that Exploring should browse (`app_url`), or none (Exploring then reads the code only)
   - the merge method (`merge_method`: `squash`, `merge` or `rebase`)
   - the GitHub user to request review from when an item is escalated or handed to a person to merge (`human_reviewer`), or none
   - the paths an agent must never merge, as gitignore-style patterns (`human_merge_paths`), or none. Suggest the files that govern the agents themselves and the release, for example the skills, the scripts and the CI workflows. A PR that changes one is reviewed by the agents and then handed to a person.
   - the build command to run before opening a PR (`build_cmd`), or none (CI is then the only build gate)
   - a git hooks directory to use when committing (`git_hooks_path`), or none
   - the files that hold the repository's contributor rules (`repo_guidance`, default `AGENTS.md`). Offer `CLAUDE.md` if that is what exists.
   - the logins of any bot account the agent runs as, if it is a GitHub App (`trusted_authors`). Markers from accounts that are not repository collaborators are ignored (see **Trust** in the protocol), and a bot has no association.
4. **Write the settings where the runner will read them.** There is no settings file. Put the values the user gave into the repository's agent instructions, so a scheduler prompt can pass them: edit `CLAUDE.md` if it exists, otherwise `AGENTS.md`, and never create the second when the first exists. Add or update a short `## GitHub workflow` section that lists each setting as the key-value input it is, for example `pr_base_branch: develop`. Show it and get a yes before writing.
5. **Create the labels.** Run the setup block in `references/labels.md` of `agent-workflow-protocol`. It is safe to run twice.
6. **Check it works.** Run `gh label list` and confirm the `agent:` labels are there.
7. **Tell the user how to start.** The ready-to-paste scheduler prompts, one per automation, come from the user-invoked `runner-prompts` skill: tell the user to run `/runner-prompts`. Suggest running each step once by hand and reading the run-log comment for **Problems** before scheduling anything. Reviewing merges PRs, so a sandbox repository is the safest place to start.

## Never

- Write a settings file. A repository's values belong in the prompt or the agent instructions.
- Change anything outside the repository's agent instructions and the label set.
- Overwrite an existing section without showing the change first.
- Run the pipeline steps themselves.
