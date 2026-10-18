# Runners

What a scheduler needs to run this package, and how to word its prompts.

## What a runner needs

| Capability | Shell runner | No-shell runner (chat automation + GitHub connector) |
|---|---|---|
| Loads skills from this package | Yes | Yes (or reads each `SKILL.md` by name) |
| Runs `scripts/lib.sh`, `gh`, `git`, `npm` | Yes | No. Follow **Running without a shell** in [agent-workflow-protocol](../skills/meta/agent-workflow-protocol/SKILL.md) and the pure-JS reference in `skills/meta/agent-workflow-protocol/scripts/helpers.mjs` |
| Writes issues, comments, labels, PRs | Yes | Yes |
| Posts as an account the repository trusts | Yes | Yes. A GitHub App's bot login goes in `trusted_authors` (see **Trust** in the protocol) |

### Exploring: full vs HTTP-only

| Mode | Needs | What Exploring can do |
|---|---|---|
| **Full Exploring** (interactive UI, canvas, command palette, screenshots) | Shell runner; product `node_modules` (or equivalent) installed in the target repo; browser binary (e.g. Playwright) present | Must-probe interactive surfaces; capture screenshots for top candidates |
| **Degraded / HTTP-only** | Skills readable; GitHub + HTTP access only (typical no-shell or under-provisioned shell) | Route / SSR / static probes only. Log `degraded: no browser` (or `degraded: no node_modules`) under **Problems** and continue |

This package stays runner-agnostic: it does not run a product `npm ci` or install browsers for you. A shell runner that wants full Exploring installs the product deps and browser stack itself (example: `npm ci && npx playwright install`). See the **Preflight** step in `explore-github-repo`.

## Prompts

Schedule the **group skill** of each step. Run an **item skill** by hand, with its issue or PR as a number or URL on the command line (or as `issue=N` / `pr=N` on a line of its own).

A prompt is the skill's command plus any `key=value` inputs, one per line. The shortest useful prompt is one line:

```text
Run /triage-github-issues on github.com/OWNER/REPO
```

For the full prompt of any skill, with **every** input it takes and its default as the value, run the user-invoked skill:

```text
/runner-prompts
```

It prints one block per pipeline skill, so a runner edits only what it cares about and deletes the rest. An empty value means *no default*. The blocks are generated from the skills' own **Inputs** sections, so they cannot go stale ([ADR 0005](./adr/0005-runner-prompts-skill.md)).

Two inputs belong on every prompt: `runner=NAME`, so the run id and the run log say who did what, and `unattended`. It defaults to `true`, meaning no human is present and nobody answers questions. Set `unattended=false` when a person is at the keyboard.

## Inputs

The canonical lists are the skills' own **Inputs** sections and the **Defaults** table in [agent-workflow-protocol](../skills/meta/agent-workflow-protocol/SKILL.md). Everything else, including the prompt blocks, is derived from them.

## Cadence (starting point)

- Exploring: a few times a week
- Triaging: daily
- Implementing: as capacity allows
- Shepherding / Reviewing: often enough that CI and review do not stall

Adjust to the repository. Skills never depend on the schedule; they select by labels and comments only.
