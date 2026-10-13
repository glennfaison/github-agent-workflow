# AGENTS.md

Conventions for working on this package. It holds agent skills. It is not an application.

## Layout

```
skills/<bucket>/<skill>/SKILL.md     exactly three levels deep
```

- **`meta`**: cross-cutting skills that are not themselves pipeline steps: `pipeline-guide` (start here), `agent-workflow-protocol`, and `setup-github-agent-workflow`.
- **`pipeline`**: the five pipeline steps — one group skill and one item skill per step.
- **`utility`**: skills the pipeline calls that do not depend on GitHub plumbing (e.g. `grill-via-github-comments`, `unattended-triage`, `merge-safety`).
- Buckets named `in-progress` and `deprecated` are never shipped or linked.

**Start with `pipeline-guide`.** It is the map of the steps and which skill to run. Point agents at it from this file and from the root README.

## Rules

- **Add or move a skill, and update four places:** the bucket `README.md`, the root `README.md`, `.claude-plugin/plugin.json`, and the skill's `agents/openai.yaml`. Run `npm run validate`: it checks all of them.
- **`name` must equal the directory name.** Harnesses discover skills by directory, so a mismatch hides the skill.
- **A skill's `description` must never contain an unquoted `: ` or ` #`.** It is invalid YAML and harnesses skip the skill. Reword it.
- **Skills reach each other through the Skill tool, never through paths.** "Call the Skill tool with `name`". A skill's own files (`references/`, `scripts/`) are read relative to its `SKILL.md`. Where a skill lives depends on how the package was installed.
- **A user-invoked skill (`disable-model-invocation: true`, with `allow_implicit_invocation: false` in `agents/openai.yaml`) can never be called by another skill.** Only `setup-github-agent-workflow` is user-invoked. Group skills dispatch to item skills, so everything else must be model-invoked.
- **Nothing repository-specific in `skills/`, `scripts/` or `tests/`.** Per-repo values are inputs a runner passes, not shipped defaults. The validator fails on references to a particular repository.
- **Shared files live in the skill that owns them.** Everything the skills share is in `agent-workflow-protocol`.

## Inputs and defaults

**Every skill has an `## Inputs` section.** It names the inputs the skill accepts, in two interchangeable forms: **key-value pairs** (`key=value` on a line of its own) and **free text** (whatever the prompt says). It also names the skill's **implicit dependencies**: the tools, skills and repository state it needs that are not inputs.

**There is no config file.** Batch sizes, lease TTLs, limits and repository settings are inputs, each with a default stated in the skill that uses it. `agent-workflow-protocol` holds the shared defaults in its **Defaults** table; `scripts/lib.sh` implements them for the shell. Set a value per run with a key-value pair, or by exporting it before sourcing the library. The validator checks that the three stay in step: a `$name` a skill body uses must appear in the Defaults table or in that skill's own Inputs section, the table and the library must list the same names, and every promoted skill must declare an `## Inputs` section.

Boilerplate every skill shares (how a skill takes its input, the eligibility check, logging a result, shell setup) lives once in `agent-workflow-protocol`. Do not copy it back into a skill.

## Docs

- `README.md`: what the package is, install, inputs. Written for a person choosing the package.
- `docs/RUNNERS.md`: what a scheduler needs and how to word its prompt. Keep it free of any one repository.
- `docs/adr/`: why the package is built this way. Add one when a decision is not obvious from the files.
- `skills/*/README.md`: one line per skill. Keep them in step with the `description` in each `SKILL.md`.

## Dependencies

`external-skills.json` lists the skills this package needs from elsewhere, and `.claude-plugin/plugin.json` declares the plugin dependency. Add to both. See [docs/adr/0001-absorb-user-invoked-skills.md](docs/adr/0001-absorb-user-invoked-skills.md).

## Checks

```bash
npm run validate   # skill structure, front matter, references, manifest, READMEs, inputs
npm test           # the shell helpers, against a stub gh
npm run check-plugin-version
```

## Releasing

Add a changeset (`npm run changeset`) for any change that users of the skills would notice. There is no lockfile: `@changesets/cli` is pinned exactly, and the release workflow runs `npm install`. A lockfile once failed `npm ci` on an optional `@types/node` peer, so add one only when `npm install && npm ci` agrees. On merge to `main`, the release workflow opens or updates a version PR. `npm run version` bumps `package.json` and syncs `.claude-plugin/plugin.json`.
