# Runner prompts are a generated, user-invoked skill

Status: accepted. Supersedes [ADR 0004](./0004-runners-doc-syncs-with-pipeline-skills.md).

ADR 0004 kept one copy-paste prompt block per pipeline skill in `docs/RUNNERS.md`, and relied on people checking both sides whenever an input changed. The same prompts were also pasted into `pipeline-guide` and partly into the README, so one input lived in four places, kept honest by hand. The guide is read in full by every agent that asks which skill to use, so the copies also cost tokens on every run. The copies had already drifted: `RUNNERS.md` showed `category=bug` where the issue format says `bugfix`, and had a stray line about a `BUCKET` that nothing used.

## Decision

- A user-invoked skill, `runner-prompts`, prints the prompt blocks. It is user-invoked because only a person setting up a scheduler asks for it, and it keeps a few hundred lines out of every agent's context.
- Its `references/prompts.md` is **generated** by `scripts/sync.mjs` (`npm run sync`) from each pipeline skill's `## Inputs` table. CI runs `npm run sync:check` and fails if the file is stale.
- The skills' Inputs tables stay canonical and every skill still lists its own inputs. Nothing is read from a config file.
- `docs/RUNNERS.md` and the README say what a runner needs and point at the skill. They carry no prompt blocks beyond the one-line quickstart.
- The "no human is present" sentence that ended every block became the `unattended` input, default `true`, so it is not pasted into each prompt.

## Consequences

- An input is changed in one place, followed by `npm run sync`. The manual two-way check of ADR 0004 is gone.
- A new pipeline skill must be added to `STEPS` in `scripts/sync.mjs`, or the script fails and says so.
- A reader on GitHub who cannot run a skill reads `references/prompts.md` directly.
