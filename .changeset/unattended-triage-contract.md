---
"github-agent-workflow": patch
---

`unattended-triage` has a `## Contract` (`kind: utility`, pure, `used_by: [triage-github-issue]`) and four scenarios: a complete bug (ready-for-agent), a feature with no use case and an issue with an open question (needs-info), and a wontfix recommendation (ready-for-human, never a close). The skill's description said it writes the outcome comment, while its body and its caller say the caller posts it. The description now says it drafts the comment and the caller posts it, as the body always did. The skill's text now says that an open question or a missing use case is needs-info and that wontfix is ready-for-human, which `triage-github-issue` already applied after the fact. The scenario checker gains an oracle for the state, the comment structure and these rules. See ADR 0013.
