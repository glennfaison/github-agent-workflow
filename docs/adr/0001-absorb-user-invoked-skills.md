# Absorb user-invoked skills instead of depending on them

Status: accepted

The workflow needs the judgment in three skills from mattpocock/skills: `triage`, `grill-with-docs` and `implement`. All three are user-invoked only (`disable-model-invocation: true`). By that repository's own rule, no other skill can call a user-invoked skill, even by naming it to the Skill tool. The workflow is run by schedulers, so no human types the commands.

## Decision

- Absorb the parts of those skills the workflow needs, adapted to run with no human present: `unattended-triage`, `unattended-grilling`, and the implementation loop inside `implement-github-issue`. Credit them in `CREDITS.md`.
- Depend on mattpocock/skills only for skills that are model-invoked: `tdd` and `code-review`.
- Declare that dependency in `.claude-plugin/plugin.json` (without a version constraint) and in `external-skills.json`. `/setup-github-workflow` checks for the skills and says how to install them.

## Consequences

- The package works unattended, and does not depend on a path into someone else's checkout.
- Fixes made upstream to the absorbed skills are not picked up automatically. Review them when `mattpocock/skills` changes.
- No version constraint on the plugin dependency: Claude Code resolves constraints against tags named `<plugin>--v<version>`, and that repository does not publish tags in that form.
