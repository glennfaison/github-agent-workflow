---
name: agent-workflow-protocol
description: Shared rules for the GitHub issue-to-merge agent workflow (leases, markers, labels, handoffs, escalation, run log, and running unattended or without a shell). Read it before using any explore-, triage-, implement-, shepherd- or review-github skill. It is reference material, not something to run on its own.
---

# GitHub workflow protocol

Shared by every skill in this package. Each of them points here first. Read this file once per run, then the reference files it names when a skill tells you to.

## The skills

The workflow has five steps. Each step has a **group skill** that selects work and an **item skill** that does the work on one item.

| Step | Group skill (selects and dispatches) | Item skill (works on one item) |
|---|---|---|
| Exploring | `explore-github-repo` | `file-github-issues` |
| Grooming | `triage-github-issues` | `triage-github-issue` |
| Implementing | `implement-github-issues` | `implement-github-issue` |
| Shepherding | `shepherd-github-prs` | `shepherd-github-pr` |
| Reviewing | `review-github-prs` | `review-github-pr` |

Item skills lean on three **utility skills** from this package: `unattended-triage` (the triage decision and its comment), `grill-via-github-comments` (one round of questions with recommended answers), and `merge-safety` (the merge gate). `setup-github-agent-workflow` is run once per repository, by a human.

**Group skills** find candidates, apply the item skill's **Eligibility** section to them, take the first `batch` that pass (oldest first; items that fail do not count toward the batch), dispatch each to the item skill by its input URL, and write one run-log entry. They never do item work themselves.

**Item skills** take exactly one issue or PR, as a URL or a number (`N` is the last path segment of a URL). On entry they check **Eligibility** themselves, so a direct call or a double dispatch is safe. If it fails they claim nothing and return `#N skipped: <reason>`. Otherwise they claim, work, write the output state, release, and return a one-line result. Run one by hand with, for example, `/triage-github-issue 123`.

**Dispatching.** To dispatch an item, call the Skill tool with the item skill's name and give it the item's URL (the item skill derives the number from it). If your runner can start sub-agents, run each item as its own sub-agent, given only the item's URL, so context stays small and one failing item cannot affect the rest. Otherwise run the items one after another. Either way, collect each item's result.

**Item result.** One line: `#N <outcome>` or `#N skipped: <reason>` or `#N failed: <reason>`. For example `#31 ready-for-agent`, `#35 skipped: leased`, `#44 failed: could not read ADR link (404)`. A group skill logs the results of the items it dispatched. An item skill run on its own writes its own run-log entry (`references/log.md`).

The steps are independent. Do not assume another step has run, will run, or is running (rule 1 below).

## Calling other skills

Skills in this package call each other through the Skill tool: "Call the Skill tool with" and then the skill's name. Do not follow `../other-skill/FILE.md` paths: where a skill lives depends on how the package was installed. A skill's own files (`references/`, `scripts/`) are read relative to the directory that holds its `SKILL.md`. If your runner has no Skill tool, find the named skill's `SKILL.md` in your skills directory and follow it as written.

Two skills are **not part of this package**, and must be installed with it. Both come from [mattpocock/skills](https://github.com/mattpocock/skills):

- `tdd`: used by `implement-github-issue` to build test-first. If it is missing, build test-first anyway and say you could not load the skill.
- `code-review`: used by `implement-github-issue` and `review-github-pr`. If a repository has its own skill of that name, that one is used. If none is installed, review the diff yourself for correctness, regressions and missing tests.

## How a skill takes its input

Every skill lists its inputs in an **`## Inputs`** section. Two forms are accepted and may be mixed in one invocation:

- **Key-value pairs.** `key=value` on a line of its own, for example `issue=123`, `app_url=https://staging.example.com`, `batch=2`. A key given this way overrides that skill's default for the same name.
- **Free text.** Anything else. Each skill says what it reads out of its own free text and how: `explore-github-repo` takes the first URL it sees, an item skill takes the first bare number or URL, and so on.

A key-value pair and free text that name the same thing resolve to the pair. An input a skill does not list is ignored, not an error.

## Defaults

**There is no config file.** Every number a skill used to read from one is now a default stated in that skill's **`## Inputs`** section, beside the input it belongs to. Override one per run by passing it as a key-value pair (`batch=2`). Leave a value out and the skill falls back to its own default, so no port, host, path or command is ever assumed.

| Name | Default | Where it is used |
|---|---|---|
| `app_url` | *(none)* | `explore-github-repo` |
| `issues_per_run` | `5` | `explore-github-repo` |
| `log_lookback_days` | `14` | `explore-github-repo` |
| `dedupe_closed_days` | `30` | `file-github-issues`, `triage-github-issue` |
| `pr_base_branch` | `main` | `implement-github-issue`, `review-github-pr` |
| `merge_method` | `squash` | `review-github-pr` |
| `human_reviewer` | *(none)* | `shepherd-github-pr`, `review-github-pr` |
| `build_cmd` | *(none)* | `implement-github-issue` |
| `git_hooks_path` | *(none)* | `implement-github-issue`, `shepherd-github-pr`, `review-github-pr` |
| `repo_guidance` | `AGENTS.md` | `implement-github-issue`, `shepherd-github-pr` |
| `lease_ttl_triage` | `1 hour` | `triage-github-issue` |
| `lease_ttl_implement` | `3 hours` | `implement-github-issue` |
| `lease_ttl_pr` | `1 hour` | `shepherd-github-pr`, `review-github-pr` |
| `groom_batch` | `5` | `triage-github-issues` |
| `implement_batch` | `1` | `implement-github-issues` |
| `shepherd_batch` | `3` | `shepherd-github-prs` |
| `review_batch` | `3` | `review-github-prs` |
| `max_shepherd_attempts` | `3` | `shepherd-github-pr` |
| `max_review_rounds` | `3` | `review-github-pr` |
| `max_item_failures` | `3` | `triage-github-issue`, `implement-github-issue`, `shepherd-github-pr`, `review-github-pr` |

## Starting a run

A runner's scheduler or webhook starts every run with a one-line prompt:

> Run /triage-github-issues on github.com/OWNER/REPO

Use any group skill, or `/explore-github-repo`. The runner decides when and how often. The skills decide what the run does. Nothing in them depends on the schedule.

## Unattended runs

- **No human is present, and nobody answers questions.** Do not stop to ask. Decide from the item's labels and comments. Where you would ask, use the skill's own route: `needs-info`, `ready-for-human` or `references/escalate.md`.
- **If you cannot do something a skill requires, do not improvise.** Record it under **Problems** in the run log, release any lease you hold, and move on to the next item.

## Shell setup

Every skill that has a shell does this first, from inside the target repository, and nothing else in a skill needs to repeat it. Run the helper library that sits in this skill's directory:

```bash
source <this skill's directory>/scripts/lib.sh
```

It requires `gh` (authenticated), `jq` and Python 3. Without a shell, see the next section.

## Running without a shell

Some runners (for example a chat automation with a GitHub connector) cannot run `scripts/lib.sh`, `gh`, `git` or `npm`. In that case:

1. The helpers and the `gh` and `git` commands in these skills say *what* to do, not how. Do the same operation with the tools you have: the same labels, the same markers, in the same order. Skip the `source` line and the `core.hooksPath` setting.
2. Set `RUN_ID` to the current UTC time as `YYYYMMDDTHHMMSSZ`, followed by `-` and the runner's name.
3. Where a skill says to check out a branch and push, commit to that branch through your tools instead.
4. If a tool a skill needs is missing (editing labels, reading check logs, merging), the last rule under **Unattended runs** applies.

## Rules every step follows

1. **Select by label, never by schedule.** Do not assume another step has run, will run, or is running. Look only at the item's labels and comments.
2. **Claim before acting. Release always.** Release on success and on failure.
3. **Be idempotent.** Before creating a branch, PR, issue or comment, check whether it already exists.
4. **Write the output state before releasing the lease.**
5. **Stay bounded.** A group skill handles at most its step's `batch` items. An item skill handles exactly one.
6. **Nothing eligible: log one line and exit.** Never invent work.
7. **Touch only what you have claimed.** The only exceptions are the comments dedupe allows on other issues.
8. **Triage and exploring never change the repository.**
9. **No unattended `wontfix`.** Prefer `ready-for-human` with a recommendation.
10. **Cap failures.** After `max_item_failures`, escalate.

## Inputs

This skill is reference material: it is never run, so it takes **no inputs** of its own. Every skill that does run names its own inputs in its own **`## Inputs`** section, and the settings they share are in **Defaults** above.

## References

| File | Holds |
|---|---|
| `references/labels.md` | labels, state transitions, one-time setup |
| `references/handoff.md` | ready and review handoff comments |
| `references/escalate.md` | when and how to give an item to a human |
| `references/dedupe.md` | duplicate search and canonical-issue rule |
| `references/issue-format.md` | well-formed issue contents |
| `references/log.md` | run-log issue and entry format (about two weeks) |
| `scripts/lib.sh` | shell helpers and default values |

## Leases

A lease is **live** only if the item carries the lease label **and** the newest `agent:lease` marker comment has not expired.

Helpers: `has_label`, `lease_live`, `claim`, `renew`, `release` (see `scripts/lib.sh`).

## Markers

Hidden HTML comments make state readable. See the full marker table in prior revisions; key markers include `agent:lease`, `agent:implements`, `agent:handoff`, `agent:attempt`, `agent:failure`, `agent:escalate`.

## Reading and writing helpers

`markers`, `prs_for_issue`, `issue_for_pr`, `review_rounds`, `shepherd_attempts`, `fail_item`, `failures`, `open_findings`, `ready_sha`, `log_issue`, `log_run`, `read_logs` — implemented in `scripts/lib.sh` when a shell is available; otherwise perform the same operations with GitHub MCP/connector tools.
