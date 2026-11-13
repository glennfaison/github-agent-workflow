---
"github-agent-workflow": patch
---

An entry of a contract's `effects.writes` can now carry an `allow` (`op`, and where it applies `label` and `marker`), so the scenario checker can tell that an effect is the right one and not only that it is in the right scope. A skill that adds `wontfix` to its claimed PR, or comments with a marker it does not list, is now a violation. A scope that has no `allow` is checked as before, and one that mixes the two is rejected. `shepherd-github-pr` is the first contract migrated (ADR 0017); the others follow a scope at a time.
