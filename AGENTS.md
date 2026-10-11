# AGENTS.md

Conventions for working on this package. It holds agent skills. It is not an application.

## Layout

```
skills/<bucket>/<skill>/SKILL.md     exactly three levels deep
```

- **`pipeline`**: the pipeline: one group skill and one item skill per step, plus the shared protocol and the setup skill.
- **`utility`**: skills the pipeline calls that do not depend on GitHub plumbing.
- Buckets named `in-progress` and `deprecated` are never shipped or linked.

## Rules

- **Add or move a skill, and update four places:** the bucket `README.md`, the root `README.md`, `.claude-plugin/plugin.json`, and the skill's `agents/openai.yaml`. Run `npm run validate`: it checks all of them.
- **`name` must equal the directory name.** Harnesses discover skills by directory, so a mismatch hides the skill.
- **A skill's `description` must never contain an unquoted `: ` or ` #`.** It is invalid YAML and harnesses skip the skill. Reword it.
- **Skills reach each other through the Skill tool, never through paths.** "Call the Skill tool with `name`". A skill's own files (`references/`, `scripts/`) are read relative to its `SKILL.md`. Where a skill lives depends on how the package was installed.
- **A user-invoked skill (`disable-model-invocation: true`, with `allow_implicit_invocation: false` in `agents/openai.yaml`) can never be called by another skill.** Only `setup-github-agent-workflow` is user-invoked. Group skills dispatch to item skills, so everything else must be model-invoked.
- **Nothing repository-specific in `skills/`, `scripts/` or `tests/`.** Per-repo values go in `.agents/docs/github-agent-workflow.env` in the consuming repo. The validator fails on references to a particular repository.
- **Shared files live in the skill that owns them.** Everything the skills share is in `agent-workflow-protocol`.

## Dependencies

`external-skills.json` lists the skills this package needs from elsewhere, and `.claude-plugin/plugin.json` declares the plugin dependency. Add to both. See [docs/adr/0001-absorb-user-invoked-skills.md](docs/adr/0001-absorb-user-invoked-skills.md).

## Checks

```bash
npm run validate   # skill structure, front matter, references, manifest, READMEs
npm test           # the shell helpers, against a stub gh
npm run check-plugin-version
```

## Releasing

Add a changeset (`npm run changeset`) for any change that users of the skills would notice. There is no lockfile: `@changesets/cli` is pinned exactly, and the release workflow runs `npm install`. (A lockfile generated in October 2026 failed `npm ci` because of an optional `@types/node` peer. Add one when `npm install && npm ci` agrees.) On merge to `main`, the release workflow opens or updates a version PR. `npm run version` bumps `package.json` and syncs `.claude-plugin/plugin.json`.
