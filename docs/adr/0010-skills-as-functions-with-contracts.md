# 0010. Skills are functions with contracts

## Status

Accepted

## Context

We want to evaluate the pipeline skills as functions: give one a state of the world and some inputs, then check what it returned and what it wrote. That needs a statement of what each skill promises, in a form a test can read.

The information was already there but scattered. A skill's preconditions were in **Eligibility**, its writes in **Outputs**, its return lines in **Result**, its forbidden writes in **Never**, and its definition of success in **Success criteria** or nowhere. Not every skill had every section, the sections drifted from the steps that used them, and nothing checked them. Reading the ten skills side by side turned up results a step could produce but never listed (`escalated` on Triaging and Implementing), side effects no section named (closing a duplicate, comments on other issues, the run-log entry), and an Inputs table that the markdown renderer split in two.

## Decision

- Every pipeline skill opens with one `## Contract`: a YAML block with `kind`, `step`, `target`, `params`, `requires`, `returns`, `ensures`, `effects`, `never`, `calls`, `idempotent` and `terminates` (group skills also have `dispatches`). **Contracts** in `agent-workflow-protocol` defines each key.
- The contract replaces the prose sections **Eligibility**, **Context read**, **Outputs**, **Result**, **Never** and **Success criteria**. **Process** stays prose and says *how*. The contract says *what*, and wins where they disagree.
- Side effects are declared by scope: `claimed` (the item the skill holds a lease on), `repository` (branches, commits, PRs, merges), `other` (any other issue or PR) and `shared` (the run log), plus `external` for things outside GitHub. **Anything not listed is forbidden.** `never` keeps the tempting exceptions explicit.
- `params` is the list of names in the `## Inputs` table. Defaults and descriptions stay in that table, which `scripts/sync.mjs` reads, so there is still one place to change an input.
- `returns` is a closed set. Item skills return `#N <outcome>` lines and always include `skipped` and `failed`. A skill that can escalate must list `escalated`.
- `scripts/contracts.mjs` checks all of this in `npm run validate`, and `tests/contracts.test.mjs` tests the checks.

This change keeps behaviour as it is. The contracts describe what the skills do today, including the awkward parts.

## Consequences

- A skill can be evaluated against its contract: the result is in `returns`, the postconditions in `ensures` hold, and a before/after diff of the world shows no write outside `effects.writes`. The scenario tests this ADR is a first step toward build on that.
- A change to a result line, a precondition or an effect is made in the contract first. The validator stops the prose and the contract drifting apart.
- Each skill grows by 20 to 30 lines net, after the prose sections the contract replaces are removed. That is the cost of having one source of truth.
- Only pipeline skills have contracts so far. Utility skills follow.

## Known gaps, not changed here (resolved in ADR 0011)

Writing the contracts down made these visible. Each is a behaviour change, so each is its own change.

1. **Logging depends on the caller.** An item skill "run on its own writes its own run-log entry", but a dispatched sub-agent is given only the item's URL, so it cannot tell it was dispatched and may log twice. A `log` input, or the group owning the entry, would fix it.
2. **`skipped` means two things.** Before a claim it means nothing happened. After a claim (`merge lane held`) it still posted a lease comment. A claimed no-op should be its own result. `review-github-pr` step 4 also sends a PR back to `agent:needs-work` with no result line of its own.
3. **`file-github-issues` has no `limit` input,** though its text refers to one, so `explore_batch` cannot be enforced by the caller.
4. **`explore_batch` has a state-dependent default** (`3` when the backlog is "large"), which makes the signature non-deterministic.
5. **Eligibility is not pure.** `clear_stale_lease` removes a label as part of checking.
6. **`triage-github-issues` housekeeping writes to issues it has not claimed.** It could be its own sweeper.
7. **"Close the issue after a merge, unless it is keep-open"** is written out in three places (`triage-github-issues` 1a, `implement-github-issue` step 2, `review-github-pr` 7.4), and "every PR closed, so `ready-for-human`" in two.
8. **`triage-github-issue` reconciles a prior outcome (step 7) after the costly decision (step 5).**
9. **Possible bugs, to confirm with a fixture.** `shepherd-github-pr` admits only `failing` and `green` checks, but handles a `DIRTY` (conflicted) branch in step 3. A conflicted PR often runs no checks, so it may never get there. A PR held out by the merge lane is claimed and released on every run, which may leave a lease comment each time.
10. **Leases are not reentrant.** `lease_live` ignores who holds the lease, so a skill that called itself on the same item would skip.
