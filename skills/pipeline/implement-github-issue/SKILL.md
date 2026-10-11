---
name: implement-github-issue
description: Implement one specific ready-for-agent GitHub issue by number and open a PR against the configured base branch. Checks first that no PR already exists for the issue, reads the Agent Brief, builds on a feature or bugfix branch, and hands the PR to Shepherding. Use when given an issue number to implement, or when implement-github-issues dispatches one to you.
---

# Implement GitHub issue

Implement one `ready-for-agent` issue and open a PR. Getting the PR through checks is the job of `shepherd-github-pr`, not this skill. This skill never waits on CI.

**Input:** an issue URL or number.

**Read first:** call the Skill tool with `agent-workflow-protocol`, then read these files in that skill's directory: `references/labels.md`, `references/escalate.md`, `references/issue-format.md`, `references/log.md` and `config.defaults.env`. Also the repository's own contributor rules, the files listed in `$REPO_GUIDANCE`.

## Eligibility

- `N` is an open issue labelled `ready-for-agent`, without `agent:stuck`.
- If it carries `agent:in-progress` and `lease_live N` succeeds, someone has it: skip.

## Inputs

- The latest **Agent Brief** comment (or the description, if the issue was filed from the "Ready for agent" template), open comments, linked ADRs, relevant code, and every image in the issue and its comments.

## Outputs

- On success: a new PR against `$PR_BASE_BRANCH` with a body ending in `<!-- agent:implements issue=N -->` and containing `Closes #N.`, labelled `agent:needs-work`. The issue loses `ready-for-agent` and gains `agent:pr-open`.
- An existing OPEN PR for the issue: no second PR. Swap the issue to `agent:pr-open`, and make sure the PR has `agent:needs-work` if it carries the implements marker.
- A MERGED PR already: close the issue.
- Only CLOSED PRs: swap to `ready-for-human` (do not retry unattended).
- Bail-out (not actually ready): swap `ready-for-agent` for `needs-info` or `ready-for-human` with a Triage Notes comment.
- Lease released.

## Process

1. **Claim.** `claim N issue agent:in-progress Implementing "$LEASE_TTL_IMPLEMENT"`. Release on every exit path from here on: finished, bail-out, escalation or failure. If `failures N Implementing` is at least `$MAX_ITEM_FAILURES`, follow `references/escalate.md` and stop. **Leave `ready-for-agent` in place.** If this run dies, the issue is still `ready-for-agent` and the next run retries. When you return `failed`, run `fail_item N issue Implementing "<reason>"` before you release.
2. **Check for existing PRs. This is what prevents duplicates.** Before writing any code, run `prs_for_issue N` (all states). It finds PRs by the `agent:implements` marker, by a `<type>/N-<topic>` branch, and by `Closes|Fixes|Resolves #N`, so it also finds PRs made by the old workflow.
   - **Any `OPEN`:** do **not** start another. Make the labels right and stop: swap `ready-for-agent` for `agent:pr-open` on the issue, and if that PR carries the `agent:implements` marker and neither `agent:needs-work` nor `agent:ready-for-review`, add `agent:needs-work` to it. A PR without the marker was written by a human: leave its labels alone. Release and stop for this issue.
   - **Any `MERGED`:** the work has shipped. `gh issue close N --comment "Implemented in #P."`, remove `ready-for-agent`, release and stop.
   - **Only `CLOSED`:** an earlier PR was abandoned. Do not try again on your own. Comment with the PR number, swap `ready-for-agent` for `ready-for-human`, release and stop.
   - **None:** continue. If a branch for the issue already exists (`git ls-remote --heads origin "*/N-*"`), check it out and carry on from it.
3. **Read context.** Find the latest `## Agent Brief` comment. **It is the contract**; the description and discussion are context. If there is no brief, the description may itself be the specification (an issue filed from the "Ready for agent" template has acceptance criteria and no brief). Then read the open comments, the ADRs it links, and the relevant code. **View every image** in the issue and its comments (screenshots, mockups): for a feature they show the intended result. Read the use case first, and build for it rather than for the letter of the proposal.
4. **Bail out if the issue is not actually ready.** If you find missing information or a decision only a human can make, post a comment in the **Triage Notes** format from `unattended-triage` (what is established, what is still needed, specific questions) and swap `ready-for-agent` for `needs-info` (or `ready-for-human`). Release and stop for this issue.
5. **Implement.** Branch name: `feature/N-<topic>` or `bugfix/N-<topic>` (lowercase kebab-case), unless the repository guidance says otherwise. Build what the brief asks, and nothing it puts out of scope:
   - Build test-first where you can, at seams the brief or the code makes obvious: call the Skill tool with `tdd`. Follow the issue's `Category:` line: for a bug, first write a test that fails because of it. For a refactor or debt issue, behaviour must not change: run the tests the brief names before and after, and do not edit them.
   - Typecheck often, run single test files often, and run the full suite once at the end.
   - Follow the repository guidance in `$REPO_GUIDANCE`, including any **Verify** checklist it has. If it describes how to split large work across sub-agents, do that for anything beyond a focused fix.
   - Commit to the branch. Then call the Skill tool with `code-review` on the work, and fix what it finds.
   - Escalate (`references/escalate.md`) if you hit a blocker you cannot resolve. If you cannot run commands, keep the change small. If it needs more than a focused change, or you cannot verify it by reading the code, bail out under step 4.
6. **Build.** If you can run commands and `$BUILD_CMD` is set, run it on this change and fix what fails. If it is empty, skip this step. If you cannot fix it, or cannot run commands, say so in the PR description and go on to step 7. CI is the build gate, and `shepherd-github-pr` handles a failing build.
7. **Open the PR.** First run `prs_for_issue N` again: another run may have opened one while you worked. If an `OPEN` PR now exists, stop and do not create another. Otherwise `gh pr create --base "$PR_BASE_BRANCH"` with a body that links the issue using `Closes #N.` (one `Closes` statement per issue) and ends with the line `<!-- agent:implements issue=N -->`.
8. **Transition.** Add `agent:needs-work` to the PR. On the issue, run one command: `gh issue edit N --remove-label ready-for-agent --add-label agent:pr-open`. Then `release N issue agent:in-progress`.

## Result

Return one line: `#N PR #P opened`, `#N existing PR #P`, `#N already merged in #P`, `#N ready-for-human`, `#N needs-info`, `#N skipped: <reason>` or `#N failed: <reason>`.

## Never

- Wait for checks, fix CI, or post the reviewer handoff. `shepherd-github-pr` does that.
- Commit or push to `$PR_BASE_BRANCH` directly, or open a PR against any other branch. Work lands on a branch, through the PR.
- Open a second PR for an issue that already has one.
