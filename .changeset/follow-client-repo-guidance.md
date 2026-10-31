---
"github-agent-workflow": minor
---

Every step now reads the client repository's own agent guidance (`AGENTS.md`, `CLAUDE.md`, contributing guide, templates, and label descriptions) before it acts, and follows it over this package's defaults. An issue the repository says to keep open (for example one labelled `evergreen`) is never closed: the PR uses `Refs #N` instead of `Closes #N`, Reviewing and Triaging leave it open after a merge, dedupe does not close it, and an issue GitHub closed anyway is reopened. New helpers `client_guidance_files` and `item_labels`; `repo_guidance` is now read by Exploring's filing step, Triaging, Implementing, Shepherding and Reviewing.
