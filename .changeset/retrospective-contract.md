---
"github-agent-workflow": patch
---

`retrospective` has a `## Contract` (`kind: utility`, pure, `used_by: []`) and five scenarios over a world of run-log issues: an entry older than `days` is not used, `step` and `only_runner` filter, ranked suggestions never exceed `max_suggestions`, and a log with only idle entries gives an empty report. The scenario world can now describe run-log entries (`run`, `step`, `runner`, `at`, `outcome`, `problems`) and a scenario carries a `now` date. The skill now says what the report contains when no entry is left: `Entries considered: 0`, a summary that says nothing was found, and no suggestions. The validator accepts `used_by: []` for a skill that is not user-invoked only when the skill's text says it is run by hand, which `retrospective` now does. See ADR 0013.
