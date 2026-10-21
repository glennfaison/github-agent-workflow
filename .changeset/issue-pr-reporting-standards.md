---
"github-agent-workflow": minor
---

Standardize issue reporting and harden agent PR requirements.

- Ship GitHub issue form templates (bug, feature, refactor/debt) under `.github/ISSUE_TEMPLATE/` aligned with the category-specific sections in `issue-format.md`.
- Add `references/pr-format.md`: agent PR body checklist (one core problem, evidence of before/after, ADR check). Client PR templates take precedence; agents fill any gaps.
- Wire the checklist into `implement-github-issue` (writer) and `review-github-pr` (enforcer before merge).
- Tighten `issue-format.md` golden rules and Environment field for bugs.
