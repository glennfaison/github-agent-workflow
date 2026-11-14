# github-agent-workflow

## 1.11.1

### Patch Changes

- 875c84a: The remaining contracts (the four group skills, `reconcile-github-issues`, `file-github-issues`, `explore-github-repo` and `setup-github-agent-workflow`) now list what they may write as `allow` entries, which completes ADR 0017: every contract that writes is checked by what it writes and not only by where. An `allow` for `create_issue` and `create_pr` now has a required `labels` list, so "new issues, with no labels" and "a PR labelled agent:needs-work" are checked, and `implement-github-issue` is tightened to match. The wording of the contracts is unchanged.
- 56158fe: `triage-github-issue`, `implement-github-issue` and `review-github-pr` now list what they may write as `allow` entries (step 2 of ADR 0017), so the scenario checker refuses a label, a comment marker or an op that the skill's text does not permit, even where its scope allows a write. For example triage applying `wontfix`, implementing merging a PR, or review sending a linked issue back to `ready-for-agent`. The wording of the skills' contracts is unchanged.
- ef29e66: An entry of a contract's `effects.writes` can now carry an `allow` (`op`, and where it applies `label` and `marker`), so the scenario checker can tell that an effect is the right one and not only that it is in the right scope. A skill that adds `wontfix` to its claimed PR, or comments with a marker it does not list, is now a violation. A scope that has no `allow` is checked as before, and one that mixes the two is rejected. `shepherd-github-pr` is the first contract migrated (ADR 0017); the others follow a scope at a time.

## 1.11.0

### Minor Changes

- 3d8c535: `npm run eval -- <skill>/<scenario> --model <model>` runs a model through a skill against the `gh` simulator and judges what it did with the scenario checker. It reports a pass, a deviation from the scenario's golden, or a violation of the skill's contract, with the diff of effects and the skills the model called. It is opt-in (it needs `ANTHROPIC_API_KEY` and costs money), capped by `--max-runs`, `--max-tokens` and `--max-turns`, never part of CI, and keeps transcripts in the git-ignored `.eval/`.
- d171e89: `implement-github-issue` splits an issue that is too large for one PR into linked sub-issues (`#N split into #A, #B`), bounded by the new `max_depth` input (default `1`). `file-github-issues` takes a `parent`, `reconcile-github-issues` closes the parent when its sub-issues close, and the scenario checker rejects `lease_held=true` from a skill that does not hold the lease. See ADR 0015.

### Patch Changes

- f92015c: `diffWorlds(before, after)` in `scripts/scenario.mjs` turns the change a run left behind into the effects the scenario checker takes, so a real run can be judged by the same scope, invariant and oracle checks as a golden scenario. A change that no effect can express (a title or body edit, an edited or removed comment, a reopened item) is reported as an `unmodelled` effect, which `checkScenario` rejects unless the contract lists a new `unmodelled` write scope. Tests round-trip every golden scenario and 600 generated worlds.
- 6da1eff: The `gh` simulator for tests is finished. `gh api` answers the REST calls the package makes (a user, an item's comments, editing a comment in place, a PR's files, repository contents and tree, the PR list and one PR, and `update-branch`), a world's `faults` make a matching call fail or let another run get in first, and `tests/lib.test.sh` now runs against the simulator instead of its own stub, so there is one mock of `gh`. The checker's effect model gains `comment_edit`, so a lease edited in place is read back by `diffWorlds`.
- 302d78c: A `gh` simulator for tests (`tests/sim/bin/gh`) answers `gh` calls from a world file in the scenarios' format and logs every call. This part covers the read paths: `issue list|view`, `pr list|view|checks`, `label list`, `repo view`, `auth status` and `run view`, with `--json` fields checked against the ones `gh` really has. A command, flag or field it does not cover exits with `unsupported: <what>`, and a test fails when a skill calls a `gh` command that is not in the manifest. The write paths, `api` and fault injection follow.
- 862e759: The `gh` simulator for tests now writes. `issue edit|close|create|comment|reopen`, `pr edit|create|comment|merge` and `label create` change the world file the way `gh` would and refuse what `gh` refuses (an unknown label, a merge pinned to the wrong head, a duplicate PR), leaving the file untouched when a call fails. A run's changes are read back by `diffWorlds`. For that, a `create_issue` or `create_pr` effect can carry the new item's title, body, creation time, author and branch as `data`, and a `close` effect its `reason`.
- b0f6069: `grill-via-github-comments` has a `## Contract` (`kind: utility`, pure, `used_by: [unattended-triage]`) and three scenarios: two independent decisions asked as one round, a dependent decision left for a later round, and an open question the code answers, stated as a finding. The contract says what the text already said, that the skill returns the round and posts nothing, and its description now says it drafts the questions for the caller to post. The scenario checker accepts a list as a document value and has an oracle that checks a round against the subject's decision tree: the whole frontier is asked, nothing whose prerequisite is open, nothing that can be looked up, and every question has a recommended answer. See ADR 0013.
- 3342d51: The five group skills have scenarios (three each). A group scenario lists `expect.dispatches`, the group's `results` and its one run-log `entry`, and for `triage-github-issues` the `reconcile` call that comes first. The checker picks the batch from the real item skill's eligibility oracle, oldest first, so a dispatch of an ineligible item, one past the batch, or in the wrong order fails. It reads what a dispatch must carry from the real item contract, `write_log=false` and the run's inputs that the item lists in `params`, so a dispatch that drops `trusted_authors`, or forwards something the item does not list, fails. `explore-github-repo` is checked as its own kind of group: findings ranked best first, one call to `file-github-issues` with `limit` and the shared inputs, only filed issues counting toward the cap, and the count line and deferred list in the log. The coverage gate wants three scenarios for a group skill, one that dispatches and one that does not. See ADR 0012.
- f25834a: `merge-safety` has a `## Contract` (`kind: utility`, pure, `used_by: [review-github-pr]`) and five scenarios: a breaking change and a migration with no rollback plan (BLOCK), a clean small PR (PASS), and a moved head and a pending check (HOLD). The scenario checker has a mode for a skill that returns a document: the report must have the contract's lines and a verdict it allows, a pure skill must leave no effects, and the world settles what it can (a draft, a pending check or a head that is not the pinned one must give HOLD). The coverage gate counts a utility skill's verdicts. One behaviour is now written down: when `head` is given and is not the PR's current head, `merge-safety` assesses nothing and reports HOLD. See ADR 0013.
- 6ae692f: `claim` and `renew` now edit this account's own lease comment for the step in place instead of posting a new one each time, so an item taken through three claims of a step has one lease comment, not three. Each step keeps its own comment, a comment from another account is never edited, and if the edit fails the helper posts a new one. Because a comment's position in the thread no longer says which lease is newest, `lease_live` and `leaseState` now take the lease written last (`updated_at`, else `created_at`, else thread order); the expiry is still the `expires=` in the marker. New helper `ownLeaseComment` and CLI command `own-lease` in `helpers.mjs`, shared fixtures for the ordering, and shell tests for one comment per step, other accounts, the failed-edit fallback and the ordering (#69).
- e5fad13: Scenario checks now have an eligibility oracle for every item skill: `triage-github-issue`, `implement-github-issue` and `review-github-pr` join `shepherd-github-pr`. Each mirrors its skill's `requires`, models the lease as `lease: live | stale | none` on the item, and honours `lease_held`. A test compares each skill's number of `requires` entries with the oracle's, so a changed precondition prompts a look at the oracle. A skipped item no longer has to be free of lease labels, because the label may belong to the run that holds it. Test tooling only, with no change to any skill. See `docs/adr/0012-scenarios.md`.
- b563fd8: `prs_for_issue` and `issue_for_pr` work on a real `gh`. They asked `gh pr list` and `gh pr view` for `authorAssociation`, which `gh` rejects as a PR field (`Unknown JSON field`), so neither could find the PR that belongs to an issue. Both now read the REST pull request, which has the author's association, and apply the same trust rule as before. `issue_for_pr` reads GitHub's own issue links with `gh` 2.72 or newer, and without that it still reads the description. It now prints the issue numbers in numeric order.
- 8eb937a: A scenario can say what a second run finds, so that `idempotent` in a contract is checked. `expect.rerun` is `ineligible` (a terminal outcome), `eligible` (a failed run, which leaves the item for a retry) or `{skip: <reason>}`, and the checker asks the skill's own eligibility oracle about the same item in the world the run leaves behind. A push puts the PR's checks back to pending, so a pushed fix is not eligible again until CI reports. A scenario with `interrupted: true` returns no result and must be eligible again, with a stale lease, and its `rerun_effects` may not repeat what the interrupted pass already did. All 30 scenarios that complete a run now carry a `rerun`, two scenarios cover an interrupted triage and an interrupted implementation, and the coverage report lists any scenario that has none, which `npm test` fails on. A test with a deliberately broken oracle shows a terminal state that is still eligible being rejected.
- dcfca22: `retrospective` has a `## Contract` (`kind: utility`, pure, `used_by: []`) and five scenarios over a world of run-log issues: an entry older than `days` is not used, `step` and `only_runner` filter, ranked suggestions never exceed `max_suggestions`, and a log with only idle entries gives an empty report. The scenario world can now describe run-log entries (`run`, `step`, `runner`, `at`, `outcome`, `problems`) and a scenario carries a `now` date. The skill now says what the report contains when no entry is left: `Entries considered: 0`, a summary that says nothing was found, and no suggestions. The validator accepts `used_by: []` for a skill that is not user-invoked only when the skill's text says it is run by hand, which `retrospective` now does. See ADR 0013.
- cd2e13c: `docs/RUNNERS.md` now covers the sweeper and the newer inputs. It says when to schedule `reconcile-github-issues` (and that Triaging also runs it), what a runner that dispatches items itself must pass (the item's URL, `write_log=false` and the group's inputs), and where `write_log`, `lease_held` and `limit` are defined. The README's schedule table lists the sweeper.
- 14b9c41: `setup-github-agent-workflow` has a `## Contract` (`kind: utility`, user-invoked, `used_by: []`) and five scenarios: an empty repository gets every label, an existing `agent:` label is reset and an existing triage label is kept, a second run changes nothing, the settings go into `CLAUDE.md` when it exists, and only the `## GitHub workflow` section is updated. Every skill now has a contract, and `CONTRACT_PENDING` is empty. The skill lists its nine settings in an Inputs table, which the protocol's Defaults rows now name it as a user of, and the protocol says that `repository` writes include repository settings such as the label set. The scenario world can hold the repository's labels and files, with `label_create`, `label_update` and `write_file` effects that `diffWorlds` also produces. The label set a scenario expects is read from `references/labels.md`. See ADR 0013.
- 87feef1: `tests/lib.test.sh` now checks for `jq`, `git` and `node` first and exits with one line naming the missing tool, instead of printing dozens of `jq: command not found` errors and ending with a long list of failures. The hooks check in `npm test` now says how to install the hooks (`npm ci`) and how to skip the check (`HUSKY=0`). `AGENTS.md` lists what the checks need.
- 85dd01f: `unattended-triage` has a `## Contract` (`kind: utility`, pure, `used_by: [triage-github-issue]`) and four scenarios: a complete bug (ready-for-agent), a feature with no use case and an issue with an open question (needs-info), and a wontfix recommendation (ready-for-human, never a close). The skill's description said it writes the outcome comment, while its body and its caller say the caller posts it. The description now says it drafts the comment and the caller posts it, as the body always did. The skill's text now says that an open question or a missing use case is needs-info and that wontfix is ready-for-human, which `triage-github-issue` already applied after the fact. The scenario checker gains an oracle for the state, the comment structure and these rules. See ADR 0013.

## 1.10.0

### Minor Changes

- ce94b8f: The contract format now covers utility and reference skills (ADR 0013). `kind: utility` has an optional `step`, a `used_by` that lists the skills that call it, and a `returns` that describes a document (named sections, an allowed set of verdicts) rather than `#N` lines. `kind: reference` carries no other key, so `pipeline-guide`, `agent-workflow-protocol` and `runner-prompts` are exempt on the record. An empty `effects.writes` means a skill is pure, and `npm run validate` now prints a purity class (`pure`, `claimed`, `writes elsewhere`) for every contract. Every skill a contracted skill calls must have a contract, and a utility skill's `used_by` must list its callers. `CONTRACT_PENDING` names the five skills that have no contract yet (`unattended-triage`, `grill-via-github-comments`, `merge-safety`, `retrospective`, `setup-github-agent-workflow`); each follow-up removes its own name. No skill behaviour changes.
- 479906e: Every step now reads the client repository's own agent guidance (`AGENTS.md`, `CLAUDE.md`, contributing guide, templates, and label descriptions) before it acts, and follows it over this package's defaults. An issue the repository says to keep open (for example one labelled `evergreen`) is never closed: the PR uses `Refs #N` instead of `Closes #N`, Reviewing and Triaging leave it open after a merge, dedupe does not close it, and an issue GitHub closed anyway is reopened. New helpers `client_guidance_files` and `item_labels`; `repo_guidance` is now read by Exploring's filing step, Triaging, Implementing, Shepherding and Reviewing.
- b6f8cb2: Fixes the ten gaps found while writing the skill contracts (ADR 0011).

  New inputs: `write_log` (default `true`) on the four item skills, so a dispatched item no longer writes a second run-log entry; `lease_held` (default `false`), so a nested call can borrow its caller's lease; and `limit` on `file-github-issues`. Group skills now pass the item its URL, `write_log=false` and every group input the item also accepts, where a sub-agent used to get only the URL and lose `runner`, `unattended` and `trusted_authors`.

  New results: `#N noop: <reason>` (claimed, nothing to do, released), `#N not ready: <reason>` from `review-github-pr`, and `deferred: over limit` from `file-github-issues`. `skipped` now always means nothing was claimed.

  `shepherd-github-pr` now treats a conflicting branch as work whatever its checks say, and reads the merge lane and merge state before claiming, so a PR that can only wait no longer collects a lease comment on every run. Eligibility checks only read: `clear_stale_lease` is no longer part of them.

  New skill `reconcile-github-issues`, which takes over the housekeeping that `triage-github-issues` did (closing issues whose PR merged, abandoned PRs, label repair) and clears stale lease labels. The rule for what an issue becomes after its PRs settle is now one reference, `references/issue-after-pr.md`. `triage-github-issue` reconciles a prior trusted outcome before it decides, not after. `explore_batch` is always `5`; it no longer drops to `3` on a "large" backlog.

- f013512: Every pipeline skill now opens with a `## Contract`: a YAML block giving its preconditions (`requires`), the closed set of result lines it can return (`returns`), its postconditions (`ensures`), every side effect by scope (`effects`), what it must never do, the skills it calls, and why it is idempotent and terminates. The contract replaces the separate Eligibility, Context read, Outputs, Result, Never and Success criteria sections. Behaviour is unchanged, with two corrections to the documented results: `triage-github-issue` and `implement-github-issue` now list `#N escalated: <reason>`, which their steps could already produce. `npm run validate` checks every contract against its skill (new `scripts/contracts.mjs`, with tests). `file-github-issues`' Inputs table is split into two valid tables, and `AGENTS.md` now lists `runner-prompts` as a meta, user-invoked skill. See `docs/adr/0010-skills-as-functions-with-contracts.md`.

## 1.9.0

### Minor Changes

- 80c15ad: Add the `retrospective` utility skill. It reads the `agent:log` run-log issues and reports ranked, evidence-backed suggestions for improving skills and process. It is read-only. Its runner filter is the input `only_runner`, so it does not collide with the shared `runner` input.

## 1.8.0

### Minor Changes

- e52cbd9: Add a third Reviewing outcome, handed to a person (ADR 0008). A PR that runs out of `max_review_rounds` no longer goes to `agent:stuck`: it gets the new label `agent:human-merge` and a comment that @mentions its CODEOWNERS (read from the base branch) and says what is still open. The new input `human_merge_paths` (gitignore-style patterns, empty by default) names files an agent must never merge: once such a PR passes review it is handed to a person the same way. `agent:human-merge` is ignored by Shepherding and Reviewing, holds no merge lane, and restarts `review_rounds`, `shepherd_attempts` and `failures`. Triaging's housekeeping now also removes `agent:pr-open` when it closes an issue whose PR was merged. Run the label setup in `references/labels.md` again to create `agent:human-merge`.

## 1.7.0

### Minor Changes

- 0924c54: Make the pipeline work with a base branch that must be up to date before a merge. Shepherding now hands PRs off one at a time through a merge lane (`lane_holder`, new input `ready_lane_ttl`, default `2 hours`) and updates a behind branch before the handoff. Reviewing defers a PR whose base moved after the handoff, with an `agent:deferred` comment, instead of sending it back with a review handoff, so it no longer uses up `max_review_rounds`. See ADR 0007.

## 1.6.0

### Minor Changes

- 6f52e18: Standardize issue reporting and harden agent PR requirements.

  - Ship GitHub issue form templates (bug, feature, refactor/debt) under `.github/ISSUE_TEMPLATE/` aligned with the category-specific sections in `issue-format.md`.
  - Add `references/pr-format.md`: agent PR body checklist (one core problem, evidence of before/after, ADR check). Client PR templates take precedence; agents fill any gaps.
  - Wire the checklist into `implement-github-issue` (writer) and `review-github-pr` (enforcer before merge).
  - `review-github-pr` deletes the source branch after a successful merge (`gh pr merge --delete-branch`).
  - Tighten `issue-format.md` golden rules and Environment field for bugs.

## 1.5.0

### Minor Changes

- 92c3f87: Implementing refuses to push a branch that does not match the documented `type/N-slug` pattern.

## 1.4.1

### Patch Changes

- 794561d: Document Exploring preflight and explicit degraded mode when node_modules / Playwright are missing.

## 1.4.0

### Minor Changes

- cb4c80a: Fix the run log opening a new issue on every run.

  - `log_issue` looked up the current log issue with `gh issue list --jq --arg ...`. `gh` has no `--arg`, so the lookup failed silently and every call created a new issue. Lookup, rotation, body and entry handling now live in `helpers.mjs`, and the tests use a `gh` stub that can actually find nothing.
  - Runners with no shell no longer use `search_issues` (an approximate index) to find the log issue; they list open `agent:log` issues.
  - One log issue is appended to for `log_window_days` (default 14; replaces `log_lookback_days`, which is still read). Concurrent runs that both create one converge on the lowest number.
  - The log issue body records `Started`, `Rotates after` and `Last entry`, and every entry carries an `at:` time. `log_status` prints them.
  - Difficulties are part of the run-log entry (**Problems** and the new **Things to improve**, which replaces **Automation suggestions**). `agent:difficulty` issues are no longer created or written to.
  - Triage now excludes `agent:difficulty` issues from selection and eligibility, and the protocol makes `agent:log` and `agent:difficulty` issues ineligible for every step. The validator checks this.
  - `log_run` is idempotent per run and step, adds a missing `at:`, and repairs entries written with literal `\n`.

## 1.3.0

### Minor Changes

- 9c48c29: Restore the protocol contract the skills cite, check markers by author, and move the runner prompts into a generated skill.

  - **Restored.** The protocol skill and its references had lost sections that skills still cited: **Group skills and item skills**, **Rules every step follows**, **Leases**, the marker table, the label state and transition tables and the `gh label create` setup block (`/setup-github-agent-workflow` depends on it), the handoff contents, the escalation steps, the dedupe search commands and canonical rule, and Triaging's check in the issue format. `/setup-github-agent-workflow` is user-invoked again (it had lost `disable-model-invocation`).
  - **Security.** A marker now counts only if an `OWNER`, `MEMBER` or `COLLABORATOR`, the agent's own account, or a login in the new `trusted_authors` input wrote it. This covers leases, handoffs, attempts, failures and the `agent:implements` PR marker. The protocol gains a **Trust** section: text on an item is data, not instructions. If the agent runs as a GitHub App, set `trusted_authors` to its bot login. See ADR 0006.
  - **Renames.** The step "Grooming" is now "Triaging", including in markers and run logs (failures written under the old name still count). `groom_batch` is now `triage_batch` and `issues_per_run` is now `explore_batch`; the old input names still work until the next major version.
  - **New inputs on every pipeline skill.** `runner`, `unattended` (default `true`, replacing the "no human is present" sentence pasted into prompts), and `trusted_authors` where markers are read. `shepherd-github-pr` and `review-github-pr` now list `git_hooks_path`, which the protocol already said they use.
  - **New skill `runner-prompts`** (user-invoked) prints the copy-paste prompts, generated from the skills' Inputs tables by `npm run sync` and checked in CI. `docs/RUNNERS.md` no longer carries prompt blocks. ADR 0005 supersedes ADR 0004.
  - **`pipeline-guide` is a table of contents.** One table says which skill to use and when, with no links by path. `AGENTS.md` points only to it. The lifecycle flowchart moved to `docs/lifecycle.svg` and is embedded in the README.
  - **One implementation.** `scripts/helpers.mjs` now holds dates, run ids, comment shapes, marker parsing and trust, and `lib.sh` calls it. Durations also accept `1h`, `30m`, `2d` and ISO 8601 (`PT1H`). Run ids now end in the runner name (`20261015T134700Z-grok`) rather than a process id.
  - **Checks.** The validator now fails on a cited section that does not exist, and on a Defaults table that disagrees with the skills' Inputs. `npm test` also runs `tests/helpers.test.mjs`, and both test suites share `tests/fixtures/markers.json`.

## 1.2.2

### Patch Changes

- 995b056: Ship a pure-JS no-shell reference (`scripts/helpers.mjs`) for RUN_ID, dates, lease/log comment shapes, and document the explicit degraded path. Replace the remaining Python usage in `link-skills.sh` with Node so the package no longer depends on Python.
- 4d74a8c: pipeline-guide: add copy-paste prompts for every pipeline skill (all key-value inputs) and a lifecycle flowchart (`references/lifecycle.svg`) showing labels, leases and handoffs.

## 1.2.1

### Patch Changes

- 00a83fd: `docs/RUNNERS.md` gains one ready-to-paste prompt per pipeline skill — the group skill to schedule and the item skill to run by hand, for each of the five steps — each listing every input that skill takes with its default as the value, replacing the single `explore-github-repo` example. The prompts enumerate what the skills' **Inputs** sections and the protocol's **Defaults** table say, which stay canonical.
- 00a83fd: Add ADR 0004 ([docs/adr/0004-runners-doc-syncs-with-pipeline-skills.md](../docs/adr/0004-runners-doc-syncs-with-pipeline-skills.md)): `docs/RUNNERS.md` keeps one prompt block per pipeline skill, listing every input with its default as the value, and any change to an input — or to the doc — checks both sides. The skills' **Inputs** sections and the protocol's **Defaults** table stay canonical.

## 1.2.0

### Minor Changes

- 256a00e: Complete remaining checklist items: pin mattpocock-skills@1.3.0, replace Python date helpers with Node.js, per-step difficulty log issues, machine-readable YAML log headers

## 1.1.0

### Minor Changes

- b1a4916: Improve skill structure and ergonomics for unattended runners

  - Rename `unattended-grilling` → `grill-via-github-comments`
  - Rename `file-github-issue` → `file-github-issues` and support batch + dry_run
  - Move `pipeline-guide`, `agent-workflow-protocol`, and `setup-github-agent-workflow` to `skills/meta/`
  - Point AGENTS.md and READMEs at `pipeline-guide` as the entry point
  - Prefer 2-week log windows over monthly
  - Inline minimum Exploring rules; reduce mandatory pre-reading
  - Strengthen explore guidance (must-probe checklist, success criteria, unattended mode)
  - Document degraded / no-shell path more clearly

## 1.0.1

### Patch Changes

- 8465ba2: `docs/RUNNERS.md` gains a "Copy-paste prompts" section: one ready prompt per scheduled step, listing every input that step's skills take with the default as the value, so a scheduler can paste a block and edit only what it cares about. The prompts enumerate what the skills' **Inputs** sections and the protocol's **Defaults** table say, which stay canonical.

## 1.0.0

### Major Changes

- 8c8b2f4: Skills take their inputs as key-value pairs or free text, and there is no config file.

  Every skill now has an `## Inputs` section naming what it accepts, in two interchangeable forms: `key=value` pairs and free text. It also names the skill's implicit dependencies (tools, skills, repository state) and states the **default** for each value where one is sensible.

  The shared config file is gone: `config.defaults.env` has been deleted, and with it the per-repository `.agents/docs/github-agent-workflow.env` override file. Batch sizes, lease TTLs, escalation limits, the PR base branch, merge method, build command and repository guidance are now inputs with defaults, collected in the **Defaults** table in `agent-workflow-protocol` and implemented by `scripts/lib.sh`. Override one per run with a key-value pair (`pr_base_branch=develop`) or by exporting it before sourcing the library (`AGENT_OVERRIDES` points at a file of pairs). `scripts/lib.sh` exports every default in both the documented lowercase and the historical uppercase name, so a runner's existing `PR_BASE_BRANCH` still works.

  `/setup-github-agent-workflow` no longer writes a settings file: it creates the labels and records the repository's values in its agent instructions, so the scheduler prompt can pass them. The validator checks the Inputs sections, the Defaults table and the shell library stay in step instead of checking against a config file.

  This is a breaking change: no compatibility shim remains.

### Patch Changes

- cbec32a: `pipeline-guide` links a rendered lifecycle diagram: `references/lifecycle.svg`, beside the plain-text diagram in the "Lifecycle at a glance" section. The plain-text version is unchanged and remains the in-context copy; the diagram adds no transitions of its own, and the labels reference in `agent-workflow-protocol` stays the source of truth.

## 0.2.0

### Minor Changes

- d52d0a7: Repeated failures on one item are now capped. A failed run leaves a `fail_item` comment, and after `MAX_ITEM_FAILURES` (default 3) the step escalates the item to `agent:stuck` instead of retrying it forever and filling every batch (see ADR 0003).

  Issues are filed and checked per category. `issue-format.md` now has Required sections for bugs (steps or trace, severity), features, refactors (a behaviour guard) and debt (cost), a title pattern for each, and Impact and Confidence on every issue. `file-github-issue` drops a finding that lacks a Required section, and never files a possible vulnerability. Agent briefs and `implement-github-issue` follow the category (a failing test first for a bug, unchanged tests for a refactor).

  Handoffs and logs: Reviewing posts a "merged" note with the `merge-safety` verdict after it merges. Handoffs open with a one-line summary. Escalations carry their counts and failure reasons. Run-log problems get a tag (`failed`, `escalated`, `flaky`, `degraded`, `repo-state`, `security`), and `read_logs` leaves out idle entries.

  Less repetition: how an item skill takes its input, the eligibility check, logging a result and shell setup now live once in `agent-workflow-protocol`. The validator also checks that every `$KEY` a skill names exists in `config.defaults.env`.

- a62d1bd: Add `docs/RUNNERS.md` (what a scheduler needs, prompts for runners that cannot load skills, a starting cadence). Add `APP_URL` to the config: Exploring uses it when the prompt gives no URL, and explores the code only when there is none, instead of stopping. `implement-github-issue` and `review-github-pr` now use `$PR_BASE_BRANCH` instead of naming `develop` or `main`, `issue-format.md` no longer lists one product's areas, and the docs name Python 3, not GNU `date`, as the date requirement. `pipeline-guide` gains a lifecycle diagram. The validator rejects hard-coded branch names in skills.

### Patch Changes

- 5de3896: The workflow config contract, setup skill, validator and tests now use
  `.agents/docs/github-agent-workflow.env`. `merge-safety` evaluates compatibility only
  when it is explicitly requested.
