---
name: setup-github-agent-workflow
description: Configure a repository for the GitHub agent workflow once. Checks dependencies, records repository settings in agent instructions, and creates the labels the pipeline needs. User-invoked. Run once per repo.
---

# Setup GitHub agent workflow

One-time setup for a repository that will run the issue-to-merge pipeline.

## Inputs

**Free text.** Optional context about the repository (default branch, app URL, reviewer preferences).

**Key-value pairs.** Optional overrides for the shared defaults in `agent-workflow-protocol` (for example `pr_base_branch`, `app_url`, `human_reviewer`).

**Implicit dependencies.** Write access to the repository, ability to create labels, and the rest of this package installed so the pipeline skills are available.

## Process

1. Confirm the package skills are discoverable (including `pipeline-guide` and `agent-workflow-protocol`).
2. Collect repository settings (base branch, app URL if any, human reviewer, build command, hooks path) and write them into the repository agent instructions so later runs do not need to ask.
3. Create the labels documented in `agent-workflow-protocol/references/labels.md` if they are missing.
4. Create or point at the agent log issue pattern.
5. Summarize what was configured and what the human should schedule next.

## Never

- Run the pipeline steps themselves.
- Push application code changes unrelated to agent instructions and labels.
