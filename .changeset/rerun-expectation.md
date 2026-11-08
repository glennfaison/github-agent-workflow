---
"github-agent-workflow": patch
---

A scenario can say what a second run finds, so that `idempotent` in a contract is checked. `expect.rerun` is `ineligible` (a terminal outcome), `eligible` (a failed run, which leaves the item for a retry) or `{skip: <reason>}`, and the checker asks the skill's own eligibility oracle about the same item in the world the run leaves behind. A push puts the PR's checks back to pending, so a pushed fix is not eligible again until CI reports. A scenario with `interrupted: true` returns no result and must be eligible again, with a stale lease, and its `rerun_effects` may not repeat what the interrupted pass already did. All 30 scenarios that complete a run now carry a `rerun`, two scenarios cover an interrupted triage and an interrupted implementation, and the coverage report lists any scenario that has none, which `npm test` fails on. A test with a deliberately broken oracle shows a terminal state that is still eligible being rejected.
