---
name: runner-prompts
description: Print ready-to-paste scheduler prompts for the pipeline skills, one block per skill, each listing every input with its default. User-invoked. Use when setting up a scheduler or running a pipeline skill by hand and you want the exact prompt.
disable-model-invocation: true
---

# Runner prompts

Print the copy-paste prompts a scheduler, webhook or person gives to a runner. Each block names one pipeline skill and lists **every** input that skill takes, with its default as the value, so nothing a skill accepts is hidden.

## Inputs

**Free text.** Which step or skill the prompts are for (for example "triage", "review-github-prs"), and optionally the repository as `owner/repo`. With no step named, print every block.

**Key-value pairs.** `key=value` on a line of its own, all optional:

| Input | Default | What it does |
|---|---|---|
| `repo` | *(none)* | The repository, as `owner/repo`. Replaces `OWNER/REPO` in the blocks |
| `runner_name` | `NAME` | The runner name. Replaces `NAME` in the blocks |

**Implicit dependencies.** Only the file `references/prompts.md` next to this skill. It needs no GitHub access and changes nothing.

## Process

1. Read `references/prompts.md`.
2. Print the preamble once, then the blocks for the steps asked for. Each step has a group block (the skill a scheduler runs) and an item block (the skill run by hand on one issue or PR).
3. Replace `OWNER/REPO` with `repo`, and `NAME` with `runner_name`, when given. Change nothing else: a value in a block is that input's default, and the user may edit it.
4. Say that the skills' own **Inputs** sections are authoritative if a block ever disagrees with one.

## Never

- Invent an input, or leave one out. `references/prompts.md` is generated from the skills' Inputs sections (`npm run sync`) and checked in CI.
- Edit `references/prompts.md` by hand.
- Run any pipeline skill.
