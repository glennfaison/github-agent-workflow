# 0012. Scenarios check a skill's outcome against its contract

## Status

Accepted

## Context

ADR 0010 gave every pipeline skill a contract, and ADR 0011 closed the gaps it exposed. A contract says what a skill promises. Nothing yet checked an outcome against it. The skills are instructions a model follows, so a test cannot run one without a model, and no model is available in CI.

## Decision

A **scenario** is a world, a skill and its inputs, and the expected outcome: one result line, and the net effects the run leaves behind (`tests/scenarios/<skill>/*.yaml`). `scripts/scenario.mjs` checks a scenario against the skill's real contract, read from its `SKILL.md`:

1. The result is one of the contract's `returns`, and is about the target.
2. Every effect is in a scope that `effects.writes` allows (`claimed`, `repository`, `other`, `shared`).
3. The world after the effects satisfies the invariants:
   - one state label per issue, one PR state label per PR, one PR holding the merge lane;
   - the lease label is gone from the claimed item;
   - no keep-open issue is closed;
   - a merge is pinned to the reviewed head, is not in a run that pushed, and is not of a fork, a draft, an `agent:stuck` PR or a protected path;
   - `skipped` leaves no effects, `noop` leaves only the lease comment, `escalated` adds `agent:stuck` with an `agent:escalate` comment, `failed` leaves the labels alone;
   - a dry run writes nothing, `limit` is respected, and only skills in the contract's `calls` are called.
4. Eligibility **oracles**, which are `requires` written as code, agree with the result. Every skill that works one target has one: `triage-github-issue`, `implement-github-issue`, `review-github-pr` and `shepherd-github-pr`. The lease is part of the world (`lease: live | stale | none` on the item), and `lease_held: true` makes the oracle require a live lease.

`tests/scenarios.test.mjs` runs every scenario, runs negative tests that prove the checker rejects broken ones, and requires every result a skill declares to have at least one scenario (`npm run scenarios:coverage`).

## Consequences

- A new result line, or a changed write scope, cannot land without a scenario. The old behaviour of the gap-9 bug (a conflicted PR skipped as `no-checks-yet`) is now a failing test.
- The same checker can judge a real run. Diff the world before and after, turn the diff into effects, and pass the result line. The part that is not built is the part that needs infrastructure: a `gh` simulator over a world file, and a runner that drives a model against it.

## What this does not prove

- **It does not run a skill.** The goldens are written from the skill text, so they check that the contract, the expected outcomes and the invariants agree with each other. They cannot show that a model follows the text.
- **The goldens can be wrong in the same way as the contract.** Both came from the same reading of the skills. A scenario that a real run contradicts should change one of them.
- **Scopes are checked, not the lists under them.** The contract's `effects.writes` entries are prose, so an effect is checked against its scope and not against the exact sentence.
- **An oracle duplicates the prose.** Each oracle is `requires` written a second time, so the two can drift. A test compares the number of `requires` entries with `ORACLE_REQUIRES` in `scripts/scenario.mjs` and fails when they differ. It is a prompt to look, not a proof: rewording an entry without changing the count goes unnoticed. Group skills have no oracle.
