# GitHub Agent Workflow Skills

Agent skills that run a GitHub repository's issue-to-merge pipeline with nobody at the keyboard.

```
explore ──► triage ──► implement ──► shepherd ──► review ──► merged
```

## Skills

### Meta ([skills/meta](./skills/meta/README.md))

- **[pipeline-guide](./skills/meta/pipeline-guide/SKILL.md)**: Map of the steps and which skill to run. Start here.
- **[agent-workflow-protocol](./skills/meta/agent-workflow-protocol/SKILL.md)**: Shared rules (leases, markers, labels, handoffs, log, degraded/no-shell path).
- **[setup-github-agent-workflow](./skills/meta/setup-github-agent-workflow/SKILL.md)**: One-time repository setup. User-invoked.

### GitHub workflow ([skills/pipeline](./skills/pipeline/README.md))

- **[explore-github-repo](./skills/pipeline/explore-github-repo/SKILL.md)**: Explore the live app and the code, rank findings, and file the best as issues.
- **[file-github-issues](./skills/pipeline/file-github-issues/SKILL.md)**: File one or more findings as issues after a duplicate check. Supports batch and dry-run.
- **[triage-github-issues](./skills/pipeline/triage-github-issues/SKILL.md)** / **[triage-github-issue](./skills/pipeline/triage-github-issue/SKILL.md)**
- **[implement-github-issues](./skills/pipeline/implement-github-issues/SKILL.md)** / **[implement-github-issue](./skills/pipeline/implement-github-issue/SKILL.md)**
- **[shepherd-github-prs](./skills/pipeline/shepherd-github-prs/SKILL.md)** / **[shepherd-github-pr](./skills/pipeline/shepherd-github-pr/SKILL.md)**
- **[review-github-prs](./skills/pipeline/review-github-prs/SKILL.md)** / **[review-github-pr](./skills/pipeline/review-github-pr/SKILL.md)**

### Utility ([skills/utility](./skills/utility/README.md))

- **[unattended-triage](./skills/utility/unattended-triage/SKILL.md)**
- **[grill-via-github-comments](./skills/utility/grill-via-github-comments/SKILL.md)**
- **[merge-safety](./skills/utility/merge-safety/SKILL.md)**

## Install

See the previous README sections on Claude Code plugin, `npx skills`, and vendored installs. Dependencies: `mattpocock/skills` (`tdd`, `code-review`).

## Inputs and defaults

There is no config file. See `agent-workflow-protocol` **Defaults** and each skill's **Inputs** section. Exploring accepts `app_url`, `issues_per_run`, `log_lookback_days`, `dry_run`.
