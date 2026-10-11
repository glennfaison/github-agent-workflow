---
name: setup-github-agent-workflow
description: Configure a repository for the GitHub agent workflow skills
disable-model-invocation: true
---

# Set up the GitHub workflow

Run once per repository, by a maintainer, before any other skill in this package. It checks the skills this package needs, records the repository's settings, and creates the labels the workflow uses. A human is present, so ask questions one at a time and show the default for each.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read `config.defaults.env` and `references/labels.md` in that skill's directory.

## Process

1. **Check the tools.** `gh auth status` must succeed, and `jq` and GNU `date` must exist. Run `gh repo view --json nameWithOwner` and confirm with the user that this is the repository to set up.
2. **Check the skills this package needs from elsewhere.** Look through your available skills for `tdd` and `code-review`. They come from [mattpocock/skills](https://github.com/mattpocock/skills), and the workflow calls them. A repository's own `code-review` skill also satisfies the second. For anything missing, tell the user how to install it, then continue:
   - Claude Code: `claude plugins install mattpocock-skills`
   - Any agent: `npx skills@latest add mattpocock/skills` (and pick `tdd` and `code-review`)
3. **Ask for the repository's settings**, one question each, with the default from `config.defaults.env`:
   - the branch agent PRs target (`PR_BASE_BRANCH`)
   - the merge method (`MERGE_METHOD`: squash, merge or rebase)
   - the GitHub user to request review from when an item is escalated (`HUMAN_REVIEWER`), or none
   - the build command to run before opening a PR (`BUILD_CMD`), or none (CI is then the only build gate)
   - a git hooks directory to use when committing (`GIT_HOOKS_PATH`), or none
   - the files that hold the repository's contributor rules (`REPO_GUIDANCE`). Default `AGENTS.md`. Offer `CLAUDE.md` if that is what exists.
4. **Write `.agents/docs/github-agent-workflow.env`**, with only the values that differ from the defaults, each with a one-line comment. Show it and get a yes before writing. If the file already exists, show the difference and ask before changing anything.
5. **Create the labels.** Run the setup block in `references/labels.md`. It is safe to run twice.
6. **Add a pointer to the repository's agent instructions.** Edit `CLAUDE.md` if it exists, otherwise `AGENTS.md`, and never create the second when the first exists. Add a short `## GitHub workflow` section saying the workflow's settings are in `.agents/docs/github-agent-workflow.env` and naming the group skills (`/explore-github-repo`, `/triage-github-issues`, `/implement-github-issues`, `/shepherd-github-prs`, `/review-github-prs`). If a section like it already exists, update it.
7. **Check it works.** Run `gh label list` and confirm the `agent:` labels are there. If you have a shell, follow **Shell setup** in the protocol and print `PR_BASE_BRANCH` to confirm the repository's override was read.
8. **Tell the user how to start.** Give them the one-line prompts to put in a scheduler, one per automation, with the repository filled in:

   | Step | Prompt |
   |---|---|
   | Exploring | `Run /explore-github-repo on github.com/OWNER/REPO` |
   | Grooming | `Run /triage-github-issues on github.com/OWNER/REPO` |
   | Implementing | `Run /implement-github-issues on github.com/OWNER/REPO` |
   | Shepherding | `Run /shepherd-github-prs on github.com/OWNER/REPO` |
   | Reviewing | `Run /review-github-prs on github.com/OWNER/REPO` |

   Suggest running each once by hand and reading the run-log comment for **Problems** before scheduling anything. Reviewing merges PRs, so a sandbox repository is the safest place to start.

## Never

- Change anything outside `.agents/docs/github-agent-workflow.env`, the label set, and the pointer in step 6.
- Overwrite an existing settings file or section without showing the change first.
