# 0016. Run a model through a skill against the simulator, and check the outcome

## Status

Accepted and built (#61). It follows ADR 0012 (scenarios), 0014 (the `gh` simulator) and the `diffWorlds` of #59.

## Context

A scenario says what a skill should do in a world, and `checkScenario` checks that statement against the contract. Nothing checked what a model does. A maintainer who changes a skill could not tell whether a model still follows the contract, short of pointing one at a real repository.

## Decision

`npm run eval -- <skill>/<scenario> --model <model>` (`scripts/eval.mjs`):

1. Seeds a world file from the scenario's `world` (`tests/sim/seed.mjs`), and makes a sandbox: a bare `origin` and a checkout with a branch per open PR, so `git push` works and a push can be seen.
2. Gives a model the skill's name, the scenario's `inputs` (the target as the skill's own parameter, `unattended=true`, `write_log=false` and `runner=eval` unless the scenario says otherwise), a `Skill` tool and a `bash` tool. `gh` there is the simulator. Every `Skill` call is recorded.
3. Reads back the last result line of the final answer, the skills called (not the entry skill, and not a `kind: reference` skill that is only read), and `diffWorlds(before, after)`. A head that moved on `origin` is a push. The `agent:lease` comment is left out of the diff, since the checker adds a claim's lease itself.
4. Judges it two ways. `checkScenario` on the run (its result, effects and `calls` in place of the golden's) gives **violations** of the contract. A comparison with the golden gives **deviations**: another outcome, an effect missing or extra (by op, target, label and marker; not by a sha or the words of a comment), other skills called, a different `rerun`. A run with a violation is a violation, one with only deviations is a deviation, and otherwise it passes.

Constraints, each tested:

- **Opt-in.** It does nothing without `ANTHROPIC_API_KEY` and says so, before anything is made. It is not in `npm test` or CI. The tests use a scripted runner and a fake `fetch`.
- **Cost-capped.** `--max-tokens` is a budget for the whole invocation, counted from the usage of every request. `--max-turns` caps a run and `--max-runs` the scenarios of a skill name. A run that reaches a cap is `incomplete` and not judged.
- **The model is an input.** `--model` or `EVAL_MODEL`, with no default.
- **Transcripts** are written to `.eval/transcripts/`, git-ignored.
- **The model's shell gets only `PATH`** (plus the simulator's variables and a git identity), so the API key and a GitHub token are not in its environment.
- **The runner is a seam.** `main` takes a `runner`, so a test (or another harness) can stand in for the model and still use the real sandbox, simulator and judge.
- **`--skills-dir`** gives the model another copy of the skills while the contract comes from the package, which is how a deliberately wrong skill is tried.

## What it does not do

- **It is not a sandbox.** The model's commands run on the machine, in a temporary directory. Use a container for a skill that is not trusted.
- **It runs item skills only.** Group and utility scenarios expect dispatches and documents, not one run's effects.
- **It cannot show prose-only world fields** (ADR 0014). The report notes a scenario that has them, since a deviation may come from that.
- **One run is one sample.** A model is not deterministic, so a single pass proves little and a single deviation proves little. `--max-runs` does not repeat a scenario.
- **A fixed prompt.** The model is asked to call the skill and end with its result line. How a real scheduler prompts it is in `docs/RUNNERS.md` and the runner prompts, and is not reproduced here.
- **Costs are estimates by token, not money.** Prices change, so the report counts tokens.
