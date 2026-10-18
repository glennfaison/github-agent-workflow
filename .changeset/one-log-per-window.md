---
"github-agent-workflow": minor
---

Fix the run log opening a new issue on every run.

- `log_issue` looked up the current log issue with `gh issue list --jq --arg ...`. `gh` has no `--arg`, so the lookup failed silently and every call created a new issue. Lookup, rotation, body and entry handling now live in `helpers.mjs`, and the tests use a `gh` stub that can actually find nothing.
- Runners with no shell no longer use `search_issues` (an approximate index) to find the log issue; they list open `agent:log` issues.
- One log issue is appended to for `log_window_days` (default 14; replaces `log_lookback_days`, which is still read). Concurrent runs that both create one converge on the lowest number.
- The log issue body records `Started`, `Rotates after` and `Last entry`, and every entry carries an `at:` time. `log_status` prints them.
- Difficulties are part of the run-log entry (**Problems** and the new **Things to improve**, which replaces **Automation suggestions**). `agent:difficulty` issues are no longer created or written to.
- Triage now excludes `agent:difficulty` issues from selection and eligibility, and the protocol makes `agent:log` and `agent:difficulty` issues ineligible for every step. The validator checks this.
- `log_run` is idempotent per run and step, adds a missing `at:`, and repairs entries written with literal `\n`.
