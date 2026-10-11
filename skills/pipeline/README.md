# GitHub workflow

The five steps of the issue-to-merge pipeline. Each step has a **group skill** that selects work and an **item skill** that does the work on one issue or PR. Run a group skill on a schedule. Run an item skill by hand on a number.

## Shared

- **[pipeline-guide](./pipeline-guide/SKILL.md)**: Map of the steps and which skill to run. Read-only index.
- **[agent-workflow-protocol](./agent-workflow-protocol/SKILL.md)**: Leases, markers, labels, handoffs, escalation, the run log and the config. Reference material that every other skill here reads first.
- **[setup-github-agent-workflow](./setup-github-agent-workflow/SKILL.md)**: Configure a repository for the workflow: settings, labels, pointers. User-invoked. Run once per repo.

## Exploring

- **[explore-github-repo](./explore-github-repo/SKILL.md)**: Explore the live app and the code, rank findings, and file the best as issues.
- **[file-github-issue](./file-github-issue/SKILL.md)**: File one finding as an issue after a duplicate check.

## Grooming

- **[triage-github-issues](./triage-github-issues/SKILL.md)**: Scan the open issues, tidy finished ones, and dispatch the rest.
- **[triage-github-issue](./triage-github-issue/SKILL.md)**: Triage one issue to `ready-for-agent`, `ready-for-human` or `needs-info`.

## Implementing

- **[implement-github-issues](./implement-github-issues/SKILL.md)**: Pick the `ready-for-agent` issues and dispatch them.
- **[implement-github-issue](./implement-github-issue/SKILL.md)**: Implement one issue and open a PR.

## Shepherding

- **[shepherd-github-prs](./shepherd-github-prs/SKILL.md)**: Pick the PRs that need work and have finished their checks, and dispatch them.
- **[shepherd-github-pr](./shepherd-github-pr/SKILL.md)**: Get one PR through checks and post the review handoff.

## Reviewing

- **[review-github-prs](./review-github-prs/SKILL.md)**: Pick the PRs ready for review and dispatch them.
- **[review-github-pr](./review-github-pr/SKILL.md)**: Review one PR and merge it, pinned to the reviewed commit, when it is safe.
