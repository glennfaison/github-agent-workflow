# The runner doc stays in step with the pipeline skills

Status: superseded by [ADR 0005](./0005-runner-prompts-skill.md)

`docs/RUNNERS.md` tells a scheduler what to run, and its prompt blocks are ready to paste: one per pipeline skill, listing every input that skill takes with its default as the value. Those facts — input names, defaults, which skill does what — live canonically in each skill's **Inputs** section, the **Defaults** table in `agent-workflow-protocol`, and `scripts/lib.sh`, which implements them. The doc is therefore a derived view, and a derived view drifts: a block kept after an input is renamed, or prose kept after a skill's behaviour changes, sends a runner a stale prompt. `scripts/validate-skills.mjs` keeps the skill side honest — Inputs sections, Defaults table and shell library must agree — but it does not read `docs/`, and nothing obliges an edit on one side to open the other.

## Decision

- `docs/RUNNERS.md` holds one prompt block per pipeline skill: the group skill a step schedules, and the item skill run by hand on one issue or PR. Each block lists every input that skill takes, with its default as the value; an empty line means no default.
- The skills stay canonical. The doc only enumerates what they say, and its **Inputs** section says so, so a disagreement has a winner.
- Changing an input is one change, not two: add, remove, rename or re-default an input in a skill and update its block in `docs/RUNNERS.md` in the same edit. The reverse holds too — edit a RUNNERS.md block and re-check the skill's Inputs section it claims to enumerate. **Check both sides any time one of them changes**, and the rule covers prose about a skill's behaviour, not just the input blocks.
- The validator stays the automated backstop for the skill side; the two-way check is manual because the doc quotes the skills instead of importing them.

## Consequences

- A runner pastes a block without reading three `SKILL.md` files first, and the block names every input the skill accepts, so nothing discoverable is hidden.
- The doc restates facts. An input changed in a skill and not in the doc leaves a stale block until someone checks the other side — that check is the only guard.
- A new pipeline skill needs a block for each half (group and item) in `docs/RUNNERS.md`, alongside the manifest and README entries the validator already checks.
- A runner reading only the doc still gets the canonical answer to any disagreement, because the doc points back at the skills.
