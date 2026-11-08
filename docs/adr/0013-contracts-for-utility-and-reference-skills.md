# 0013. Contracts for utility and reference skills

## Status

Accepted

## Context

ADR 0010 gave the pipeline skills a contract, so that each can be evaluated as a function. Only those skills have one. `unattended-triage`, `grill-via-github-comments`, `merge-safety` and `retrospective` are utility skills, and `setup-github-agent-workflow` is run by hand. Pipeline skills call the first three, and the judgement a model makes is concentrated in them. Nothing checks any of the five.

The contract format does not fit them. `scripts/contracts.mjs` accepts `kind: item | group | sweep`, requires one of the five pipeline steps, and expects `returns` to be `#N <outcome>` lines. A utility skill returns a document, and several write nothing, so they are the natural pure skills. Three meta skills (`pipeline-guide`, `agent-workflow-protocol`, `runner-prompts`) are never run, so a contract would have nothing to say.

## Decision

- **`kind: utility`.** `step` is optional. A new `used_by` lists the skills that call it. `returns` describes the shape of the document (named sections, an allowed set of verdicts) and may not use `#N` lines. Every other key is required, as for an item skill. A utility skill cannot claim.
- **`kind: reference`.** The block holds `kind` and nothing else: no effects, no returns, no scenarios. Exempting these skills is therefore stated in each one, and a skill that has other keys is not exempt. The alternative was to leave them without a block and have the validator know their names. That would make the exemption invisible and a new reference skill easy to forget.
- **An empty `effects.writes` means pure.** The validator prints a class for each contract: `pure`, `claimed` (only `claimed`) or `writes elsewhere` (anything else). Evaluation can start with the pure skills, which need no model of the world beyond what they read. **Contracts** in the protocol states the rule.
- **The loop between callers and callees is closed.** A skill's `calls` may only name a skill in this package that has a contract, and if that skill is a utility skill its `used_by` must list the caller. The other way round, every name in `used_by` must call the skill. A user-invoked utility skill has `used_by: []`, because no skill can call it. The rule covers a utility skill that calls another (`unattended-triage` calls `grill-via-github-comments`), so `used_by` is the list of callers, which are not all pipeline skills. Skills from `external-skills.json` are exempt, since this package cannot give them a contract.
- **Writing the five contracts is not part of this change.** Two of them (`merge-safety`, `unattended-triage`) are already in a pipeline skill's `calls`, so the new rule would fail on them straight away. `CONTRACT_PENDING` in `scripts/validate-skills.mjs` names the five skills that wait for a contract. A pending skill may be called without one. Each follow-up change removes its skill from the list, and the validator fails if a skill that has a contract is still on it. The list is not a place to add to.

This change does not alter how any skill behaves.

## Consequences

- Every skill with a contract is evaluated the same way: the result is in `returns`, the postconditions in `ensures` hold, and nothing is written outside `effects.writes`. For a pure skill that last part is trivially checkable.
- `scripts/scenario.mjs` and the scenario tests still cover the pipeline skills only. A scenario for a utility skill compares a document to its shape, which needs a design of its own, and goes with the contract tickets.
- A pipeline skill cannot start calling a new in-package skill until that skill has a contract.
- The list of pending skills is a visible debt. It was already there as five skills nobody checked. Now the validator prints it.

## Known gaps, not changed here

- `returns` for a utility skill is prose. The validator checks that it is present and is not `#N` lines, and does not check a skill's output against it.
- `used_by` and `calls` can disagree only through a contract the validator has not seen yet, namely a pending skill. It does not check those pairs until the pending skill has a contract.

## Update: scenarios for a skill that returns a document

`merge-safety` was the first utility skill to get a contract, and with it the design this ADR left open. A scenario for a skill whose contract has `kind: utility` has `expect.document` (a map from each line of the report to its value) and `expect.effects`, and no `target`.

- **The document has the shape of `returns`.** Each `returns` entry reads `Label: alternative | alternative`. A scenario's document must have every label and no other, and each value must start with one of the alternatives (`Unknown — <evidence>` is matched on `Unknown`), or the alternative is a `<placeholder>` and the value is not empty.
- **The first line of `returns` is the verdict.** The coverage gate wants a scenario for every fixed alternative of that line, as it wants one for every result line of a pipeline skill.
- **An empty `effects.writes` means no effects.** A scenario that expects one is rejected. A utility skill that writes is checked against its scopes as an item skill is.
- **Rules that follow from the world are code.** `DOCUMENT_ORACLES` in `scripts/scenario.mjs` holds them, as `ORACLES` holds eligibility. For `merge-safety`: a draft, a pending check or a pinned `head` that is not the PR's head must give HOLD, PASS needs green checks and no conflicts, PASS has no next steps and BLOCK or HOLD has at least one.

Still not checked: whether the model's assessment of a real diff is right. That needs the agent runner (#61).

### A utility skill that a person runs by hand

`retrospective` can be called by the model (it is not user-invoked) and no skill in the package calls it. ADR 0013 asked for `used_by` to list the callers of any such skill, which left it nothing to list. The rule is relaxed in one place: `used_by: []` is accepted for a skill that is not user-invoked when its text, outside the contract, says that it is **run by hand**. The validator looks for that phrase, so the exemption stays visible in the skill and a forgotten caller is still reported: a skill that lists another in `calls` fails if that skill's `used_by` leaves it out, whatever the note says. Making `retrospective` user-invoked instead would have changed how the package ships and disabled implicit invocation, which nobody asked for.

For `retrospective` the scenario world holds run-log issues (labelled `agent:log`, with `entries` of `run`, `step`, `runner`, `at`, `outcome` and `problems`), and a scenario says what time it is (`now`) and which entries the report used (`expect.used`). The oracle works out which entries fall inside `days`, `step` and `only_runner` and are not idle, and checks the report against that set and against `max_suggestions`.

### A utility skill that writes: `setup-github-agent-workflow`

The last skill without a contract is the one that changes repository settings, so its contract is not pure. Its writes are `repository` writes: the label set and the agent instructions file are repository settings, and `other` means any other issue or PR. The protocol's definition of `repository` now says so. A user-invoked skill has `used_by: []`, and the skill never touches an issue or a PR, which the scope check enforces.

The world model gained repository state to express this. A world may hold `labels` (`name`, `description`) and `files` (path to text), and three effects change them: `label_create`, `label_update` (a label that exists, reset) and `write_file`. `diffWorlds` produces them, so a real run is judged like a golden. A removed label or file is `unmodelled`.

- **The label set is read from `references/labels.md`**, not copied. `labelCatalog` parses the setup block, and a scenario writes `{from: labels.md}` in `world.labels` and `{op: labels_sync}` in `expect.effects`. The oracle also compares the label effects of any scenario with what the block does to that world, so a hand-written list is checked too.
- **What the block does to a label that exists differs by label.** The eight `agent:` labels are made with `--force`, which resets an existing label to the description in the file. The three triage labels are made without it, and an existing one is left as it is. Ticket #58 expected every existing label to be kept. The contract and the scenarios state what the block actually does, and `ensures` says it. Whether an existing `agent:` label should be reset or kept is a decision about the block, not about the contract.
- **The instructions file** is `CLAUDE.md` if it exists, otherwise `AGENTS.md`. The oracle checks that each setting the maintainer gave is a `key: value` line in the `## GitHub workflow` section, that nothing outside that section changes, and that a file written unchanged is not a write.
- **`params` is now an Inputs table.** The skill listed its nine settings in prose, so it has a table, and the protocol's Defaults rows name the skill as a user of each.

`CONTRACT_PENDING` is empty. Every skill has a contract.

