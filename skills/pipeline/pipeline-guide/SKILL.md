---
name: pipeline-guide
description: Find the right skill in the issue-to-merge pipeline (explore, triage, implement, shepherd, review) and whether to run the group skill or the item skill. Read-only index; it runs no step. Use when unsure which pipeline skill applies.
---

# Pipeline guide

A map of the pipeline. It runs nothing: invoke a skill by name, or read its `SKILL.md`.

## Inputs

**Free text.** What you are trying to do, in your own words. That description is what this skill maps onto a step below.

**Key-value pairs.** None. There is nothing here to parameterise.

**Implicit dependencies.** The `SKILL.md` files of every skill it points at. This skill reads those pointers and runs nothing, so it needs no shell, no `gh` and no config.

Each step has a **group skill** that selects work from the repository and an **item skill** that does the work on one issue or PR. Run a group skill on a schedule. Run an item skill by hand on one issue or PR URL.

| Step | Group skill (whole backlog) | Item skill (one URL) |
| --- | --- | --- |
| Explore the live app and code; file issues | [explore-github-repo](../explore-github-repo/SKILL.md) (takes the app URL) | [file-github-issue](../file-github-issue/SKILL.md) |
| Triage to `ready-for-agent`, `ready-for-human` or `needs-info` | [triage-github-issues](../triage-github-issues/SKILL.md) | [triage-github-issue](../triage-github-issue/SKILL.md) |
| Implement a `ready-for-agent` issue and open a PR | [implement-github-issues](../implement-github-issues/SKILL.md) | [implement-github-issue](../implement-github-issue/SKILL.md) |
| Get a PR through checks and post the review handoff | [shepherd-github-prs](../shepherd-github-prs/SKILL.md) | [shepherd-github-pr](../shepherd-github-pr/SKILL.md) |
| Review a ready PR and merge when safe | [review-github-prs](../review-github-prs/SKILL.md) | [review-github-pr](../review-github-pr/SKILL.md) |

## Which one do I run?

- A whole backlog, on a schedule: the **group skill** for the step.
- One issue or PR you already have a number or URL for: the **item skill**. It checks eligibility itself, so a wrong guess is safe.
- An item an agent gave up on (`agent:stuck`): none. A human fixes it and removes the label.
- First time in a repository: [setup-github-agent-workflow](../setup-github-agent-workflow/SKILL.md).

## Lifecycle at a glance

```
issue   (no label) --triage--> ready-for-agent --implement--> agent:pr-open --merged--> closed
                      |-------> needs-info      (a human answers and removes the label: back to triage)
                      '-------> ready-for-human

PR      agent:needs-work --shepherd--> agent:ready-for-review --review--> merged
             ^                                   |
             '-------------- sent back ----------'

any     agent:stuck: an agent gave up. Every step ignores the item until a human removes the label.
```

The same lifecycle, rendered with the return paths drawn: [lifecycle.svg](references/lifecycle.svg).

Every label and transition is in [labels.md](../agent-workflow-protocol/references/labels.md). If a skill disagrees with it, labels.md wins.

Shared:

- [agent-workflow-protocol](../agent-workflow-protocol/SKILL.md): leases, markers, labels, handoffs, escalation, the run log, how a skill takes its input and the shared defaults. Reference only; every pipeline skill reads it first.
- [setup-github-agent-workflow](../setup-github-agent-workflow/SKILL.md): configure a repository once (labels, agent instructions, scheduler prompts). User-invoked.

Also used by the pipeline: [unattended-triage](../../utility/unattended-triage/SKILL.md), [unattended-grilling](../../utility/unattended-grilling/SKILL.md) and [merge-safety](../../utility/merge-safety/SKILL.md).
