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
- The same checker can judge a real run. `diffWorlds(before, after)` in `scripts/scenario.mjs` turns the change a run left behind into the effects the checker takes, and `applyEffects(before, diffWorlds(before, after))` gives `after` back (tested on every golden scenario and on generated worlds). A change no effect can express, such as a title or a body edit of an item that already existed, comes out as an `unmodelled` effect, which the checker rejects unless the contract lists an `unmodelled` write. What a new item is made with (title, body, creation time, author and, for a PR, branch) is part of creating it, so a `create_issue` or `create_pr` effect carries it as `data`, a `close` carries its `reason`, and a comment edited in place is a `comment_edit` (its index among the item's comments, and its new text). The `gh` simulator over a world file is described in `0014-gh-simulator.md`. The part that is not built is a runner that drives a model against it.

## What this does not prove

- **It does not run a skill.** The goldens are written from the skill text, so they check that the contract, the expected outcomes and the invariants agree with each other. They cannot show that a model follows the text.
- **The goldens can be wrong in the same way as the contract.** Both came from the same reading of the skills. A scenario that a real run contradicts should change one of them.
- **Scopes are checked, and the lists under them only where a contract has structured entries.** An `effects.writes` entry is prose unless it carries an `allow`, so an effect in a prose scope is checked against the scope and not against the exact sentence. ADR 0017 adds `allow` and migrates the skills a scope at a time.
- **An oracle duplicates the prose.** Each oracle is `requires` written a second time, so the two can drift. A test compares the number of `requires` entries with `ORACLE_REQUIRES` in `scripts/scenario.mjs` and fails when they differ. It is a prompt to look, not a proof: rewording an entry without changing the count goes unnoticed. Group skills have no oracle.

## Update: group skills

A group skill has scenarios too. What a group promises is a selection and a set of dispatches, so its scenario says that instead of a result and effects: `expect.dispatches` (the items in order, the inputs each was given and the result each returned), `expect.results` (what the group returns), `expect.log` (the one run-log entry) and, for `triage-github-issues`, `expect.reconcile` (the call that comes first). Running the dispatched items is not checked here: they have scenarios of their own.

- **The checker picks the batch itself.** It orders the world's items by `createdAt` (by number when they have none), keeps those that the item skill's own oracle calls eligible, and takes the first `*_batch`. A scenario that dispatches an ineligible item, one past the batch, a different order, or leaves an eligible one out, fails. An item that fails the oracle does not use up the batch.
- **What a dispatch must carry is read from the item's contract.** It is `write_log=false` and every input of this run that the item lists in `params`, and nothing else. A dispatch that drops `trusted_authors`, or forwards a batch size the item does not list, fails. An input the run did not set is not forwarded, so the item falls back to its default.
- **The log entry lists the dispatched results in order**, with what reconciling did for triage, or `nothing eligible` when both are empty. The idle entry is always written.
- **`explore-github-repo` is the odd one.** Its candidates are findings it ranks (`findings: [{title, score}]`), and it calls `file-github-issues` once, with every finding best first and `limit` set to its batch. The checker verifies the order, the forwarded inputs, that only `filed` and `would-file` count toward the limit and everything after it is `deferred: over limit`, the `<N> filed, <M> commented, <K> dropped` line, and the deferred list in the log (at most 20). Its contract has no `nothing eligible` line, so an empty round returns the zero count line and calls nothing.
- **Coverage** wants three scenarios for each group skill, one that dispatches and one that does not.
