---
name: agent-workflow-protocol
description: Shared rules for the GitHub issue-to-merge agent workflow (leases, markers, labels, handoffs, escalation, run log, config, and running unattended or without a shell). Read it before using any explore-, triage-, implement-, shepherd- or review-github skill. It is reference material, not something to run on its own.
---

# GitHub workflow protocol

Shared by every skill in this package. Each of them points here first. Read this file once per run, then the reference files it names when a skill tells you to.

## The skills

The workflow has five steps. Each step has a **group skill** that selects work and an **item skill** that does the work on one item.

| Step | Group skill (selects and dispatches) | Item skill (works on one item) |
|---|---|---|
| Exploring | `explore-github-repo` | `file-github-issue` |
| Grooming | `triage-github-issues` | `triage-github-issue` |
| Implementing | `implement-github-issues` | `implement-github-issue` |
| Shepherding | `shepherd-github-prs` | `shepherd-github-pr` |
| Reviewing | `review-github-prs` | `review-github-pr` |

Item skills lean on three **utility skills** from this package: `unattended-triage` (the triage decision and its comment), `unattended-grilling` (one round of questions with recommended answers), and `merge-safety` (the merge gate). `setup-github-agent-workflow` is run once per repository, by a human.

**Group skills** find candidates, apply the item skill's **Eligibility** section to them, take at most the step's `*_BATCH` items (oldest first), dispatch each to the item skill, and write the run-log entry. They never do item work themselves.

**Item skills** take exactly one issue or PR number. On entry they check eligibility themselves, so a direct call or a double dispatch is safe. Then they claim, work, write the output state, release, and return a one-line result. Run one by hand with, for example, `/triage-github-issue 123`.

**Dispatching.** To dispatch an item, call the Skill tool with the item skill's name and give it the item's URL (the item skill derives the number from it). If your runner can start sub-agents, run each item as its own sub-agent, given only the item's URL, so context stays small and one failing item cannot affect the rest. Otherwise run the items one after another. Either way, collect each item's result.

**Item result.** One line: `#N <outcome>` or `#N skipped: <reason>` or `#N failed: <reason>`. For example `#31 ready-for-agent`, `#35 skipped: leased`, `#44 failed: could not read ADR link (404)`.

The steps are independent. Do not assume another step has run, will run, or is running (rule 1 below).

## Calling other skills

Skills in this package call each other through the Skill tool: "Call the Skill tool with" and then the skill's name. Do not follow `../other-skill/FILE.md` paths: where a skill lives depends on how the package was installed. A skill's own files (`references/`, `scripts/`) are read relative to the directory that holds its `SKILL.md`. If your runner has no Skill tool, find the named skill's `SKILL.md` in your skills directory and follow it as written.

Two skills are **not part of this package**, and must be installed with it. Both come from [mattpocock/skills](https://github.com/mattpocock/skills):

- `tdd`: used by `implement-github-issue` to build test-first. If it is missing, build test-first anyway and say you could not load the skill.
- `code-review`: used by `implement-github-issue` and `review-github-pr`. If a repository has its own skill of that name, that one is used. If none is installed, review the diff yourself for correctness, regressions and missing tests.

## Per-repository config

Defaults ship in `config.defaults.env`, next to this file. A repository overrides any of them in `.agents/docs/github-agent-workflow.env`, which `/setup-github-agent-workflow` writes. The repository's value wins. Skills refer to these names (`$PR_BASE_BRANCH`, `$BUILD_CMD`, `$REPO_GUIDANCE`, and so on). Without a shell, read both files and apply the same layering.

## Starting a run

A runner's scheduler or webhook starts every run with a one-line prompt:

> Run /triage-github-issues on github.com/OWNER/REPO

Use any group skill, or `/explore-github-repo`. The runner decides when and how often. The skills decide what the run does. Nothing in them depends on the schedule.

## Unattended runs

- **No human is present, and nobody answers questions.** Do not stop to ask. Decide from the item's labels and comments. Where you would ask, use the skill's own route: `needs-info`, `ready-for-human` or `references/escalate.md`.
- **A run may find nothing to do, or start while another is running.** Both are normal. Rules 1, 3, 5 and 6 below cover them.
- **If you cannot do something a skill requires, do not improvise.** Record it under **Problems** in the run log, release any lease you hold, and move on to the next item.

## Shell setup

From inside the target repository, run the helper library that sits in this skill's directory:

```bash
source <this skill's directory>/scripts/lib.sh   # loads config, sets RUN_ID, defines the helpers
```

With a shell, it requires `gh` (authenticated), `jq` and GNU `date`. Without one, see the next section.

## Running without a shell

Some runners (for example a chat automation with a GitHub connector) cannot run `scripts/lib.sh`, `gh`, `git` or `npm`. In that case:

1. The helpers and the `gh` and `git` commands in these skills say *what* to do, not how. Do the same operation with the tools you have: the same labels, the same markers, in the same order. Skip the `source` line and the `core.hooksPath` setting.
2. Set `RUN_ID` to the current UTC time as `YYYYMMDDTHHMMSSZ`, followed by `-` and the runner's name.
3. Where a skill says to check out a branch and push, commit to that branch through your tools instead.
4. If a tool a skill needs is missing (editing labels, reading check logs, merging), the last rule under **Unattended runs** applies.

## Rules every step follows

1. **Select by label, never by schedule.** Do not assume another step has run, will run, or is running. Look only at the item's labels and comments.
2. **Claim before acting. Release always.** Release on success and on failure. Do it explicitly: each command may run in its own shell, so a shell `trap` cannot be relied on. A crashed run is covered by lease expiry.
3. **Be idempotent.** Before creating a branch, PR, issue or comment, check whether it already exists. Rerunning a skill on the same item must be safe.
4. **Write the output state before releasing the lease.** If a run dies midway, the item stays in its input state and the next run retries it.
5. **Stay bounded.** A group skill handles at most its step's `*_BATCH` items (see config). An item skill handles exactly one. One item failing does not stop the rest. Log it and move on.
6. **Nothing eligible: log one line and exit.** Never invent work.
7. **Touch only what you have claimed.** The only exceptions are the comments dedupe allows on other issues.
8. **Triage and exploring never change the repository.** No commits, no branches, no edits to `GLOSSARY.md`, ADRs or `.out-of-scope/`. Put proposed changes in a comment.
9. **No unattended `wontfix`.** If an issue looks already implemented or should be rejected, do not close it. Set `ready-for-human` and give the recommendation and reason in the comment.

## References

Read these when a skill points at them. All are in this skill's directory.

| File | Holds |
|---|---|
| `references/labels.md` | every label, its meaning, the state transitions, one-time setup |
| `references/handoff.md` | what the ready and review handoff comments contain |
| `references/escalate.md` | when and how to give an item to a human (`agent:stuck`) |
| `references/dedupe.md` | duplicate search and the canonical-issue rule |
| `references/issue-format.md` | what a well-formed issue contains |
| `references/log.md` | the monthly run-log issue and entry format |
| `config.defaults.env` | batch sizes, lease TTLs, limits, repository defaults |
| `scripts/lib.sh` | the helpers named below |

## Leases

A lease is **live** only if the item carries the lease label **and** the newest `agent:lease` marker comment has not expired. Anything else counts as unleased. This includes a label with no marker, a label with an expired marker, and a missing label.

| Helper | Does |
|---|---|
| `has_label N issue\|pr LABEL` | exit 0 if N currently carries LABEL |
| `lease_live N` | exit 0 if the newest lease marker on N is unexpired |
| `claim N issue\|pr LABEL STEP TTL` | add the label, post a lease marker |
| `renew N issue\|pr STEP TTL` | post a newer marker. Do this before the lease runs out, if a long task needs it |
| `release N issue\|pr LABEL` | remove the label |

TTLs are `LEASE_TTL_TRIAGE`, `LEASE_TTL_IMPLEMENT` and `LEASE_TTL_PR` in the config (see **Per-repository config**).

Typical use:

```bash
if has_label "$N" issue agent:triage && lease_live "$N"; then continue; fi   # someone has it
claim "$N" issue agent:triage Grooming "$LEASE_TTL_TRIAGE"
# ... work ...
release "$N" issue agent:triage                                       # on EVERY way out: success, bail-out, escalation, failure
```

Concurrency is best-effort. Two runs can claim the same item in the same second. This is accepted: every step is idempotent, so the worst case is duplicated work.

## Markers

Hidden HTML comments make state readable without parsing prose. Append them as the last line of the comment they belong to. Exception: `agent:implements` lives in the PR description. Never put markers in an issue description.

| Marker | Written by | Used for |
|---|---|---|
| `<!-- agent:lease step=… run=… expires=… -->` | `claim`, `renew` | lease expiry |
| `<!-- agent:implements issue=N -->` | Implementing, in the **PR description** | links a PR to its issue, so a second PR is never opened for it (`prs_for_issue N`) |
| `<!-- agent:handoff kind=ready sha=… -->` | Shepherding | the PR was reviewable at this head SHA |
| `<!-- agent:handoff kind=review sha=… open=N -->` | Reviewing, when it does not merge; `N` = findings still unfixed | counts review rounds (`review_rounds N`); `open_findings N` tells Shepherding what is left |
| `<!-- agent:attempt step=shepherding sha=… -->` | Shepherding, after each fix push | counts attempts since the last handoff of any kind (`shepherd_attempts N`) |

## Reading and writing helpers

| Helper | Does |
|---|---|
| `markers N` | every agent marker on N, in order |
| `prs_for_issue N` | every PR for issue N, one `<number> <OPEN\|MERGED\|CLOSED>` per line. Matches the `agent:implements` marker, a `<type>/N-<topic>` branch, or `Closes\|Fixes\|Resolves #N` in the body |
| `issue_for_pr N` | the issue numbers PR N implements |
| `review_rounds N`, `shepherd_attempts N` | the two counters above |
| `open_findings N` | review findings still open on a PR (0 if none) |
| `ready_sha N` | head SHA recorded by the newest `kind=ready` handoff |
| `log_issue`, `log_run FILE`, `read_logs DAYS` | see `references/log.md` |
