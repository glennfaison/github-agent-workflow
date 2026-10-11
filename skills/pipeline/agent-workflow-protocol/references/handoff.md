# Handoff comments

Elsewhere a handoff is often a document that compacts a conversation for another agent. In this workflow a handoff is a **comment**, so:

- Write for a fresh agent with none of your context, reference artifacts (PR, issue, commit, check run) by link instead of copying them, and redact secrets and personal data.
- Open with one sentence that says where things stand, then the sections. Keep it short enough to skim: a long handoff hides the one line a human needs.
- Compose it in a file in the OS temp directory, then post it with `gh pr comment N --body-file FILE`. **Never write it into the repository.**
- End the comment with the marker the step requires (see `../SKILL.md`).

## Contents by author

| Author | Comment | Required content |
|---|---|---|
| Shepherding | the "ready" handoff on a PR | **Changes** made, **Decisions** taken and why, **Risks**, **Verification** actually run (commands and results, and a link to the green check run), **Reviewer focus** (where to look hardest), **Not done** (anything the issue asked for that this PR leaves out, and why) |
| Reviewing, not merged | the "review" handoff on a PR | **Verdict**, **Findings**: each with what is wrong, why, and whether it is fixed (with the commit) or still open; **What remains**; **Verification** you ran; **Round** (`review_rounds N` of `$MAX_REVIEW_ROUNDS`) |
| Reviewing, merged | the "merged" note on a PR, posted right after the merge | **Verdict** from `merge-safety` (compatibility, reversibility, GitHub readiness) and the outcome of `code-review`; **Verification** you ran; the merge commit and `$MERGE_METHOD`. It keeps the reason for an unattended merge with the PR |
| Any step that escalates | the escalation comment | see `escalate.md` |

## Issues

For an issue, the comment `unattended-triage` writes is the handoff: an **Agent Brief** for `ready-for-agent`, the same structure plus why it cannot be delegated for `ready-for-human`, or **Triage Notes** for `needs-info`. A conversation summary on top would only duplicate it.
