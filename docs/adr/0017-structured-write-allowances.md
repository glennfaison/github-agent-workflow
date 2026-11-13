# 0017. Say what a skill may write, not only where

## Status

Accepted. Step 1 of 3 is built (#67): the schema, the checker and `shepherd-github-pr` as the worked example. The other skills move a scope at a time, so each step can be reviewed.

## Context

`effects.writes.<scope>` was a list of sentences, and the scenario checker could compare an effect only to its scope (`claimed`, `repository`, `other`, `shared`). The contract says "anything not listed is forbidden", but the checker enforced that no more finely than the scope. A skill that added `wontfix` to the PR it had claimed, or commented on a PR it was not given, passed whenever the scope allowed a write. This was the main place where the evaluation was weaker than the contract claimed (ADR 0012, *What this does not prove*).

## Decision

An entry of `effects.writes.<scope>` is a sentence, or `{text, allow}`. The sentence stays as the explanation. `allow` is one mapping or a list, and each mapping names one kind of effect:

```yaml
claimed:
  - text: "Attempt, branch-update and ready-handoff comments, and the swap of agent:needs-work for agent:ready-for-review."
    allow:
      - { op: comment, marker: agent:attempt }
      - { op: label_remove, label: agent:needs-work }
      - { op: label_add, label: agent:ready-for-review }
```

- `op` is required and is one of the effect ops the checker models, except `unmodelled`.
- `label` is required for `label_add` and `label_remove`, and is a name or a glob. `*` is the only wildcard. Use `*` alone to allow any label, which is then a visible choice and not a gap.
- `marker` is required for `comment` and `comment_edit`: a name, a glob, or `null` for a comment with no marker (a run-log entry, a one-line comment on a linked issue). A `comment_edit` carries only an index, so its marker is the marker of the comment it edits in the world the run started from. A comment that cannot be found matches nothing.

`scripts/scenario.mjs` first places an effect in its scope (`scopeOf`, unchanged) and then, if that scope has `allow` entries, asks `allowedBy` whether one matches. All three places that checked a scope now go through one function, `forbiddenWrite`: a pure skill's effects, an item skill's effects, and the effects of a rerun. A real run is judged the same way, because `eval` reads its effects from `diffWorlds` and hands them to `checkScenario`.

**A scope is all sentences or all `allow`.** An effect in a scope with no `allow` is checked by the scope alone, as before, so no contract changes until it is migrated. Once one entry has an `allow`, only what some `allow` lists is permitted, so a sentence without one beside it would look like permission it does not give. The validator rejects the mix, and also an `allow` for an op that can never land in its scope (a `push` under `claimed`), which would allow nothing and look as if it did.

## Why not

- **Parse the sentences.** They are written for a model to follow. Parsing them would tie the wording of every skill to the checker.
- **Only check the label set.** Comments and markers are where a skill most easily writes something it should not, and the lease and handoff protocols are built on markers.
- **Require `allow` everywhere at once.** It is a large change across eleven contracts, and the scenarios would all have to be right at once. A prose scope keeps its old behaviour until it is migrated.

## What it does not do

- **`create_pr`, `create_issue`, `close` and `review_request` are matched by op alone.** What a new item is labelled with, or what a PR is closed for, is not constrained yet. The schema rejects `label` and `marker` on them, so they cannot be mistaken for checked.
- **The golden scenarios still come from the same reading of the skill.** An `allow` made from the prose and a scenario made from the prose can share a mistake. Running a model (ADR 0016) is what tests that.
- **It checks effects, not their order or count.** One extra comment with an allowed marker passes.

## Migration

1. The schema, the checker and `shepherd-github-pr` (this step).
2. The item skills: `triage-github-issue`, `implement-github-issue`, `review-github-pr`.
3. The group, sweep and file skills: the `-issues` and `-prs` groups, `reconcile-github-issues`, `file-github-issues` and `explore-github-repo`.
