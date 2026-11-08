# Utility

Building blocks the workflow skills call. Each is useful on its own and knows nothing about GitHub plumbing: none claims an item, sets a label or posts a comment.

- **[unattended-triage](./unattended-triage/SKILL.md)**: Decide an issue's category and state and draft the outcome comment (Agent Brief, ready-for-human structure or Triage Notes) for the caller to post. Adapted from `triage` in mattpocock/skills.
- **[grill-via-github-comments](./grill-via-github-comments/SKILL.md)**: Work out every open decision and ask the whole ready frontier in one round, each question with a recommended answer. Adapted from `grilling` in mattpocock/skills.
- **[merge-safety](./merge-safety/SKILL.md)**: Assess whether a PR is safe for an agent to merge on its own.
- **[retrospective](./retrospective/SKILL.md)**: Read agent run-log issues and produce concrete suggestions for improving skills and process.
