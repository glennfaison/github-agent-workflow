# AGENTS.md

Conventions for working on this package. It holds agent skills. It is not an application.

## Finding a skill

**Read `pipeline-guide` first.** It is the table of contents of this package: every skill, what it is for, and when to use it. It is the only skill this file points to, and the only place that lists the others, so do not copy that list here or anywhere else.

To open it, run `/pipeline-guide`. If your harness does not recognise slash commands, call the Skill tool with the name `pipeline-guide`. Any other skill is reached the same way, by name.

## Layout

```
skills/<bucket>/<skill>/SKILL.md     exactly three levels deep
```

- **`meta`**: cross-cutting skills that are not pipeline steps: the guide, the shared protocol, and the user-invoked setup and prompt skills.
- **`pipeline`**: the five pipeline steps, one group skill and one item skill each.
- **`utility`**: skills the pipeline calls that do not depend on GitHub plumbing.
- Buckets named `in-progress` and `deprecated` are never shipped or linked.

## Rules

- **Add or move a skill, and touch these places:** the bucket `README.md`, the root `README.md`, the guide's table, and the skill's `agents/openai.yaml`. Then run `npm run sync`, which regenerates `.claude-plugin/plugin.json` and the runner prompts. `npm run validate` checks all of it.
- **`name` must equal the directory name.** Harnesses discover skills by directory, so a mismatch hides the skill.
- **A skill's `description` must never contain an unquoted `: ` or ` #`.** It is invalid YAML and harnesses skip the skill. Reword it.
- **Skills reach each other through the Skill tool, never through paths or links.** "Call the Skill tool with `name`". A skill's own files (`references/`, `scripts/`) are read relative to its `SKILL.md`. Where a skill lives depends on how the package was installed, and installers flatten the buckets.
- **A user-invoked skill (`disable-model-invocation: true`, with `allow_implicit_invocation: false` in `agents/openai.yaml`) can never be called by another skill.** The guide marks which skills are user-invoked. Group skills dispatch to item skills, so every skill the pipeline calls must be model-invoked.
- **Nothing repository-specific in `skills/`, `scripts/` or `tests/`.** Per-repo values are inputs a runner passes, not shipped defaults. The validator fails on references to a particular repository.
- **A section a skill cites must exist.** If a skill says "see **X** in the protocol", the protocol has a heading X. The validator checks it.
- **Shared files live in the skill that owns them.** Everything the skills share is in the protocol skill.
- **One implementation per behaviour.** Dates, run ids, comment shapes and marker parsing live in the protocol's `scripts/helpers.mjs`. `lib.sh` calls it. `tests/fixtures/markers.json` is run against both.

## Inputs and defaults

**Every skill has an `## Inputs` section.** It names the inputs the skill accepts, in two interchangeable forms: **key-value pairs** (`key=value` on a line of its own) and **free text** (whatever the prompt says). It also names the skill's **implicit dependencies**: the tools, skills and repository state it needs that are not inputs. Every pipeline skill lists `runner` and `unattended`, and every skill that reads markers lists `trusted_authors`.

**There is no config file.** Batch sizes, lease TTLs, limits and repository settings are inputs, each with a default stated in the skill that uses it. The protocol's **Defaults** table holds the shared defaults and names the skills that use each; `scripts/lib.sh` implements them for the shell. Set a value per run with a key-value pair, or by exporting it before sourcing the library. The validator checks that the three agree.

**The runner prompts are generated.** Change an input in a skill's Inputs table, then run `npm run sync`. It rewrites the user-invoked prompts skill's `references/prompts.md` from those tables, and CI fails if it is stale (ADR 0005).

Boilerplate every skill shares lives once in the protocol. Do not copy it back into a skill.

## Docs

- `README.md`: what the package is, install, inputs. Embeds `docs/lifecycle.svg`.
- `docs/RUNNERS.md`: what a scheduler needs.
- `docs/adr/`: design decisions.
- `skills/*/README.md`: one line per skill.

## Dependencies

`external-skills.json` lists skills this package needs from elsewhere, pinned; `.claude-plugin/plugin.json` declares the plugin dependency.

## Checks

```bash
npm run lint                  # syntax of .mjs, .sh, .json, .yml and skill front matter (scripts/lint-files.mjs)
npm run validate
npm test                      # starts with hooks:check
npm run sync:check
npm run check-plugin-version
npm run check                 # lint, validate, check-plugin-version and test: everything CI runs
```

## Git hooks

`npm install` runs the `prepare` script, which installs [husky](https://typicode.github.io/husky/) and points `core.hooksPath` at `.husky/_`. The hooks live in `.husky/`.

- **`pre-commit`**: `lint-staged` runs `scripts/lint-files.mjs` on the staged files, then `npm run validate` checks the package-wide rules (this includes the generated-files check, `sync:check`).
- **`pre-push`**: `npm run check`.

CI runs the same checks, so `git commit --no-verify` only defers a failure. A hook does not run when `core.hooksPath` points elsewhere, when `npm install` was never run, or when `HUSKY=0` is set. `npm test` starts with `npm run hooks:check`, which fails and says how to fix it; `npm run prepare` reinstalls.

Add a check in `scripts/lint-files.mjs` (per file) or `scripts/validate-skills.mjs` (package-wide), with a test. The hooks and CI both call those scripts, so there is nowhere else to wire it in.

## Releasing

Add a changeset (`npm run changeset`) for user-visible changes.
