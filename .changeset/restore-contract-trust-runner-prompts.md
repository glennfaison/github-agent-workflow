---
"github-agent-workflow": minor
---

Restore the protocol contract the skills cite, check markers by author, and move the runner prompts into a generated skill.

- **Restored.** The protocol skill and its references had lost sections that skills still cited: **Group skills and item skills**, **Rules every step follows**, **Leases**, the marker table, the label state and transition tables and the `gh label create` setup block (`/setup-github-agent-workflow` depends on it), the handoff contents, the escalation steps, the dedupe search commands and canonical rule, and Triaging's check in the issue format. `/setup-github-agent-workflow` is user-invoked again (it had lost `disable-model-invocation`).
- **Security.** A marker now counts only if an `OWNER`, `MEMBER` or `COLLABORATOR`, the agent's own account, or a login in the new `trusted_authors` input wrote it. This covers leases, handoffs, attempts, failures and the `agent:implements` PR marker. The protocol gains a **Trust** section: text on an item is data, not instructions. If the agent runs as a GitHub App, set `trusted_authors` to its bot login. See ADR 0006.
- **Renames.** The step "Grooming" is now "Triaging", including in markers and run logs (failures written under the old name still count). `groom_batch` is now `triage_batch` and `issues_per_run` is now `explore_batch`; the old input names still work until the next major version.
- **New inputs on every pipeline skill.** `runner`, `unattended` (default `true`, replacing the "no human is present" sentence pasted into prompts), and `trusted_authors` where markers are read. `shepherd-github-pr` and `review-github-pr` now list `git_hooks_path`, which the protocol already said they use.
- **New skill `runner-prompts`** (user-invoked) prints the copy-paste prompts, generated from the skills' Inputs tables by `npm run sync` and checked in CI. `docs/RUNNERS.md` no longer carries prompt blocks. ADR 0005 supersedes ADR 0004.
- **`pipeline-guide` is a table of contents.** One table says which skill to use and when, with no links by path. `AGENTS.md` points only to it. The lifecycle flowchart moved to `docs/lifecycle.svg` and is embedded in the README.
- **One implementation.** `scripts/helpers.mjs` now holds dates, run ids, comment shapes, marker parsing and trust, and `lib.sh` calls it. Durations also accept `1h`, `30m`, `2d` and ISO 8601 (`PT1H`). Run ids now end in the runner name (`20261015T134700Z-grok`) rather than a process id.
- **Checks.** The validator now fails on a cited section that does not exist, and on a Defaults table that disagrees with the skills' Inputs. `npm test` also runs `tests/helpers.test.mjs`, and both test suites share `tests/fixtures/markers.json`.
