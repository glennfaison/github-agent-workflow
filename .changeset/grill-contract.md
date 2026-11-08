---
"github-agent-workflow": patch
---

`grill-via-github-comments` has a `## Contract` (`kind: utility`, pure, `used_by: [unattended-triage]`) and three scenarios: two independent decisions asked as one round, a dependent decision left for a later round, and an open question the code answers, stated as a finding. The contract says what the text already said, that the skill returns the round and posts nothing, and its description now says it drafts the questions for the caller to post. The scenario checker accepts a list as a document value and has an oracle that checks a round against the subject's decision tree: the whole frontier is asked, nothing whose prerequisite is open, nothing that can be looked up, and every question has a recommended answer. See ADR 0013.
