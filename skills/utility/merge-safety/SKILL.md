---
name: merge-safety
description: Assess whether a pull request is safe for an agent to merge by checking breaking changes, rollback blast radius, and merge readiness. Use when deciding whether a PR is safe to merge.
---

# Merge safety

Give an evidence-based merge-gate assessment. This is not a substitute for a
full code or security review, and it does not authorize or perform a merge.

## Contract

See **Contracts** in the protocol for what each key means. This skill returns a document, so `returns` lists the lines of the **Report**, and the first line is the verdict.

```yaml
kind: utility
params: [pr, base, head]
used_by: [review-github-pr]
requires:
  - "`pr` names one pull request that can be read."
returns:
  - "Verdict: PASS | BLOCK | HOLD"
  - "Breaking changes: None | <finding and evidence>"
  - "Reversibility: Low | Managed | High | Unknown — <rollback path and evidence>"
  - "GitHub readiness: <draft, mergeability, checks, required reviews>"
  - "Blockers or next steps: None | <specific actions>"
ensures:
  - "Exactly one verdict is given, and a missing or uncertain fact is never reported as PASS."
  - "PASS is given only when compatibility and reversibility have no unresolved blocker and every GitHub readiness requirement is met. Its `Blockers or next steps` is `None`."
  - "BLOCK names the concrete safety failure, and HOLD names the missing evidence, the pending check or review, or the draft status. Both give at least one next step."
  - "A draft, a pending check or review, or a `head` input that is not the PR's current head gives HOLD, whatever else is true."
  - "Compatibility risk, rollback risk and GitHub readiness are reported on separate lines, so a green check suite cannot hide a breaking change or an unsafe rollback."
effects:
  reads: ["the PR and its complete diff", "check state, mergeability and required reviews", "the callers and contracts the diff touches", "the linked issue, when it clarifies the intended behaviour"]
  writes: {}
never:
  - "Merge the PR, or authorize a merge."
  - "Change a label, post a comment or edit the PR."
  - "Treat the PR description as proof that checks or review passed."
  - "Turn uncertainty into a pass."
calls: []
idempotent: "It only reads, so assessing the same PR at the same head again gives the same verdict."
terminates: "A single pass over one PR's diff."
```

## Inputs

**Free text.** The pull request to assess, as a URL or a number, plus anything
you need it to consider that is not on the PR itself. Read the rest of the text
as context, not as a second instruction.

**Key-value pairs.** `key=value` on a line of its own. Recognised keys, all
optional except `pr`:

| Input | Default | What it does |
|---|---|---|
| `pr` | *(required)* | The pull request, as a URL or a number |
| `base` | *(none)* | The branch the PR merges into, when the caller already knows it |
| `head` | *(none)* | The commit being reviewed, when the caller has already pinned it |

**Implicit dependencies.** This skill needs the complete diff, the affected
callers and contracts, and the linked issue when it clarifies the intended
behaviour. It merges nothing and changes no labels.

## Workflow

1. Establish the exact PR, base and head, then inspect the complete diff and
   relevant callers or contracts. Read the linked issue when it clarifies the
   intended behavior.
   If `head` is given and is not the PR's current head, assess nothing: any
   evidence would be about a different commit. Report **HOLD**, and make the
   next step to assess the current head.
2. Check GitHub readiness from the PR itself: draft status, mergeability,
   required checks, and required reviews. Treat the PR description as a claim,
   not proof that checks or review passed.
3. Assess compatibility:
   - Identify affected public APIs, routes, serialized or exported formats,
     persisted data, schemas, defaults, configuration, and external consumers.
   - Compare the old and new behavior. Decide whether any explicitly required
     compatibility still holds.
   - Treat an addition as breaking if it changes an existing contract or
     invalidates existing data or consumers. A new option or catalog entry is
     not breaking merely because it adds behavior.
   - Do not require a migration or backward-compatibility plan by default.
     Block a break only when the issue, PR, or user explicitly requires
     compatibility, or when it breaks a contract the change did not set out
     to alter, and the break is unplanned or untested.
4. Assess reversibility:
   - Determine whether the change can be reverted after deployment, not just
     whether its diff is small or `git revert` is conflict-free.
   - Trace state or artifacts the change may create: database writes,
     migrations, exported files, user-authored content, URLs or asset
     references, and effects on external systems or consumers.
   - State the rollback path and whether rollback leaves data, references, or
     consumers stranded. Rate removal blast radius as low, managed, or high,
     with evidence. A high or unknown blast radius needs a tested rollback or
     recovery plan; otherwise block.
5. Report a verdict. Use **PASS** only when compatibility and reversibility
   have no unresolved blocker and GitHub readiness requirements are satisfied.
   Use **BLOCK** for a concrete safety failure. Use **HOLD** when evidence is
   missing, checks or reviews are pending, or the PR is still a draft. Do not
   turn uncertainty into a pass.

## Report

```text
Verdict: PASS | BLOCK | HOLD
Breaking changes: None | <finding and evidence>
Reversibility: Low | Managed | High | Unknown — <rollback path and evidence>
GitHub readiness: <draft, mergeability, checks, required reviews>
Blockers or next steps: <specific actions, or None>
```

Link findings to exact files and lines or to the relevant GitHub status. Keep
compatibility risk, rollback risk, and GitHub readiness separate so a green
check suite cannot hide a breaking change or an unsafe rollback.
