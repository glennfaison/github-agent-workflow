# 0008. Hand a reviewed PR to a person to merge

## Status

Accepted

## Context

Reviewing could end in two ways: merge, or send back. Two cases fit neither.

1. A PR runs out of `max_review_rounds` and still is not mergeable. The only exit was an escalation to `agent:stuck`, which says an agent gave up and something is broken. In practice the PR is usually reviewable and a person only has to decide. A `stuck` label does not say that, and it named at most one `human_reviewer`.
2. Some changes should never be merged unattended however well they review. In a repository where agents improve the agents' own instructions, the merge gate, the trust rules, the scripts and the release workflow are such files. ADR 0007's CI cannot tell whether a prose change alters agent behavior, so a green check is not enough.

## Decision

Add a third outcome, **handed to a person**, with its own label `agent:human-merge` and `references/human-merge.md`.

- **Two triggers.** `review-rounds`: the rounds ran out and the PR still is not mergeable. `protected-paths`: review passed, but the PR changes a file that matches the new input `human_merge_paths`. For a protected path the agents still review, fix and re-review as usual, and only the final merge is left to a person. They do not hand over unreviewed code.
- **The comment is honest.** It @mentions the owners and says why an agent is not merging, what was checked at which SHA, what is still open, and what to do. It never calls a PR safe beyond what `merge-safety` and `code-review` reported.
- **Owners.** CODEOWNERS is read from the PR's **base** branch, never its head, which the PR could edit. The owners of the changed files get an @mention and a review request, together with `human_reviewer`. With no CODEOWNERS file, `human_reviewer` is the only target and the PR is still labelled and commented.
- **Fail closed.** `protected_files` fails when the changed files cannot be read or are empty, or when a pattern is unsupported, and Reviewing then fails the item instead of merging. A pattern that silently matched nothing would let a protected file through.
- **Path patterns.** A deliberate gitignore and CODEOWNERS subset, shared by both uses (`*`, `**`, `?`, a leading or trailing `/`), in `helpers.mjs`. No negation, character classes or escapes. A renamed file counts under its old name too, so a file cannot leave a protected path by being renamed.
- **Ignored by the agents.** `agent:human-merge` is excluded like `agent:stuck`, and it holds no merge lane (ADR 0007).
- **A person's decision restarts the counts.** The `agent:human-merge` marker resets `review_rounds`, `shepherd_attempts` and `failures`, as `agent:escalate` already resets failures. A PR a person hands back with `agent:needs-work` is not escalated again on its first review.
- **No shipped default.** `human_merge_paths` is empty. Which files need a person is the repository's policy, passed in by the runner like any other input.

## Consequences

- `agent:stuck` regains its meaning: something an agent could not do. `agent:human-merge` means a decision is waiting for a person.
- A person merging a PR that is behind its base must update the branch first when the base requires it. The comment says so.
- When a person merges, no agent runs the merge path that closes the linked issue and removes `agent:pr-open`. Triaging's housekeeping now does both for any issue whose PR is merged.
- This is a policy gate, not a security boundary. It stops an agent following these skills from merging a protected path, but a token that can merge can still bypass the skills. Branch protection or a ruleset on the base branch that requires a code-owner review is what enforces it.
