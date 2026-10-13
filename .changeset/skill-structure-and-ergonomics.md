---
"github-agent-workflow": minor
---

Improve skill structure and ergonomics for unattended runners

- Rename `unattended-grilling` → `grill-via-github-comments`
- Rename `file-github-issue` → `file-github-issues` and support batch + dry_run
- Move `pipeline-guide`, `agent-workflow-protocol`, and `setup-github-agent-workflow` to `skills/meta/`
- Point AGENTS.md and READMEs at `pipeline-guide` as the entry point
- Prefer 2-week log windows over monthly
- Inline minimum Exploring rules; reduce mandatory pre-reading
- Strengthen explore guidance (must-probe checklist, success criteria, unattended mode)
- Document degraded / no-shell path more clearly
