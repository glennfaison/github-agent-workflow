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
