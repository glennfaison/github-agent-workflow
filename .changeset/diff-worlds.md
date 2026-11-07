---
"github-agent-workflow": patch
---

`diffWorlds(before, after)` in `scripts/scenario.mjs` turns the change a run left behind into the effects the scenario checker takes, so a real run can be judged by the same scope, invariant and oracle checks as a golden scenario. A change that no effect can express (a title or body edit, an edited or removed comment, a reopened item) is reported as an `unmodelled` effect, which `checkScenario` rejects unless the contract lists a new `unmodelled` write scope. Tests round-trip every golden scenario and 600 generated worlds.
