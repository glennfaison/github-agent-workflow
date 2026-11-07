---
"github-agent-workflow": patch
---

`merge-safety` has a `## Contract` (`kind: utility`, pure, `used_by: [review-github-pr]`) and five scenarios: a breaking change and a migration with no rollback plan (BLOCK), a clean small PR (PASS), and a moved head and a pending check (HOLD). The scenario checker has a mode for a skill that returns a document: the report must have the contract's lines and a verdict it allows, a pure skill must leave no effects, and the world settles what it can (a draft, a pending check or a head that is not the pinned one must give HOLD). The coverage gate counts a utility skill's verdicts. One behaviour is now written down: when `head` is given and is not the PR's current head, `merge-safety` assesses nothing and reports HOLD. See ADR 0013.
