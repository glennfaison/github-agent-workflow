# 0017. Say what a skill may write, not only where

## Status

Accepted and built (#67), in three steps so each could be reviewed: the schema, the checker and `shepherd-github-pr` as the worked example, then the other item skills, then the group, sweep, file and setup skills. Every contract that writes now lists its writes as `allow` entries.

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
- `labels` is required for `create_issue` and `create_pr`: the labels the new item may carry, each a name or a glob. Every label it is made with must match one, and `[]` means none.
- `label` is required for `label_add` and `label_remove`, and is a name or a glob. `*` is the only wildcard. Use `*` alone to allow any label, which is then a visible choice and not a gap.
- `marker` is required for `comment` and `comment_edit`: a name, a glob, or `null` for a comment with no marker (a run-log entry, a one-line comment on a linked issue). A `comment_edit` carries only an index, so its marker is the marker of the comment it edits in the world the run started from. A comment that cannot be found matches nothing.

`scripts/scenario.mjs` first places an effect in its scope (`scopeOf`, unchanged) and then, if that scope has `allow` entries, asks `allowedBy` whether one matches. All three places that checked a scope now go through one function, `forbiddenWrite`: a pure skill's effects, an item skill's effects, and the effects of a rerun. A real run is judged the same way, because `eval` reads its effects from `diffWorlds` and hands them to `checkScenario`.

**A scope is all sentences or all `allow`.** An effect in a scope with no `allow` is checked by the scope alone, as before, so no contract changes until it is migrated. Once one entry has an `allow`, only what some `allow` lists is permitted, so a sentence without one beside it would look like permission it does not give. The validator rejects the mix, and also an `allow` for an op that can never land in its scope (a `push` under `claimed`), which would allow nothing and look as if it did.

## Why not

- **Parse the sentences.** They are written for a model to follow. Parsing them would tie the wording of every skill to the checker.
- **Only check the label set.** Comments and markers are where a skill most easily writes something it should not, and the lease and handoff protocols are built on markers.
- **Require `allow` everywhere at once.** It is a large change across eleven contracts, and the scenarios would all have to be right at once. A prose scope keeps its old behaviour until it is migrated.

## What it does not do

- **`close` and `review_request` are matched by op alone.** What an issue is closed for, or who a review is requested from, is not constrained. The schema rejects `label`, `marker` and `labels` on them, so they cannot be mistaken for checked.
- **A created item's other fields are unconstrained.** Only its labels are matched. Its title, body, parent and the PR's base are not.
- **The golden scenarios still come from the same reading of the skill.** An `allow` made from the prose and a scenario made from the prose can share a mistake. Running a model (ADR 0016) is what tests that.
- **It checks effects, not their order or count.** One extra comment with an allowed marker passes.

## Notes from migrating the item skills

- **The goldens did not cover everything the skill text permits.** Each `allow` list was written from the skill's own text and its references, then run against the goldens, so a label that no scenario applies (`bug`, `enhancement`) is still listed. A golden that applies something the text does not permit would now fail, and none did.
- **Some writes cannot be expressed as effects.** `triage-github-issue` updates a description and minimizes comments. Those are `unmodelled`, which no contract lists, so a run that does either is still rejected, as before. The sentence says so, and only the comments are checked.
- **The outcome comment has no fixed marker.** The skill text does not name one and the goldens use both `agent:outcome` and none, so triage allows both. Pinning it is a skill change and not part of this one.
- **Removing a state label is listed only where the text does it.** Triage may remove `needs-triage` and its own lease, not `needs-info` (its `never` list says only a human does). An issue that already carries a state label is ineligible, so triage never swaps one.

## Notes from migrating the group and file skills

- **A group's `allow` is declarative for now.** Scenarios already forbid a group from doing item work, with an earlier and stricter rule, so its `shared` entry is exercised by the contract tests and by real runs through `eval`, not by the goldens (they have no effects).
- **`reconcile-github-issues` may add any one of the four state labels and remove the others.** Its repair picks the target by a priority order that the checker does not model, so the list permits the whole mutex set and the repair sentence says so. It never lists `needs-triage`, a lease label to add, or a lease marker.
- **`setup-github-agent-workflow` is migrated too**, though it was not in the plan: its two entries map onto `label_create`, `label_update` and `write_file`.

## Migration

1. The schema, the checker and `shepherd-github-pr`. Done.
2. The other item skills: `triage-github-issue`, `implement-github-issue`, `review-github-pr`. Done.
3. The four group skills (one run-log entry each), `reconcile-github-issues`, `file-github-issues`, `explore-github-repo` and `setup-github-agent-workflow`. Done. This step added `labels`, so "new issues, with no labels" is checked, and `implement-github-issue`'s PR (`agent:needs-work` only) and sub-issues (none) are now pinned too.
