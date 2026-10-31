# PR format (agent checklist)

What a well-formed **agent** PR must contain so Reviewing can merge it unattended. Human PRs are unconstrained; this checklist applies only to PRs that carry a trusted `<!-- agent:implements issue=N -->` marker (or were opened by `implement-github-issue`).

Client repositories often already have a `.github/PULL_REQUEST_TEMPLATE.md` (or multiple templates). **That template takes precedence.** The agent fills the client's template, then appends any items below that are still missing. If the client has no template, use the sections in this file as the body structure.

`implement-github-issue` **writes** to this checklist. `review-github-pr` **checks** it (and the existing merge-safety / code-review gates) before merging.

## Required for every agent PR

| Item | Content |
|---|---|
| **One core problem** | The PR addresses exactly one issue (or one tightly coupled set of changes that the Agent Brief treats as a single problem). No drive-by refactors, unrelated cleanups, or stacked features. Title and body make the single purpose obvious. |
| **Link to the issue** | Exactly one `Closes #N.` (or `Fixes` / `Resolves`) for the issue being implemented. For a **keep-open** issue (`client-guidance.md`) it is `Refs #N.` instead, because `Closes` would close the issue on merge. The body also ends with `<!-- agent:implements issue=N -->`. |
| **Summary** | 1–3 sentences: what changed and why, in the language of the issue / user outcome. |
| **Evidence of before and after** | Concrete proof the change works. Acceptable forms (any one is enough):
| | • Linked screenshots or screen recordings of the broken and fixed states
| | • Test output or a statement of the commands run and their results (e.g. "`npm test -- path/to/file` — 3 passed")
| | • A checked box only when the agent actually verified: `- [x] I verified the fix (tests / manual steps: …)` |
| | Unchecked boxes or vague claims ("should work") are not evidence. |
| **ADR check** | Explicit statement that the change does not conflict with existing ADRs in the repository (or names the conflict and stops). Agents read linked / relevant ADRs from the issue and the `docs/adr/` (or equivalent) tree. |
| **Verification** | What was run (commands + results) or why verification could not be run (recorded under Problems in the run log). |
| **Out of scope / Not done** | Anything the issue asked for that this PR deliberately leaves out, and why. |

## Optional but recommended

- **Risks** – anything a reviewer should watch for on merge.
- **Follow-ups** – issues to file or work that is intentionally deferred.

## Client template interaction

1. If the repository has a PR template, start from it (GitHub applies it automatically when the agent uses `gh pr create` without overriding the body entirely; when building the body in code, load the template content first if practical).
2. Fill every field the template asks for.
3. Append a short **Agent checklist** section that supplies any of the Required items still missing (especially Evidence, ADR check, and the implements marker).
4. Never remove or contradict required fields from the client's template.

## What Reviewing enforces

Before merging, `review-github-pr` confirms (in addition to green checks, `merge-safety`, and `code-review`):

- The PR body (or the ready handoff) shows **one core problem**.
- Evidence of before/after is present in one of the accepted forms.
- An ADR check statement exists and does not report an unresolved conflict.
- The implements marker and `Closes #N` (or `Refs #N` for a keep-open issue) are present and trusted. A keep-open issue with `Closes`, `Fixes` or `Resolves` is a finding that blocks merge.

If any required item is missing or clearly false, the PR is sent back to `agent:needs-work` with a review handoff naming the gaps. Do not merge on the strength of an unchecked box or an empty Evidence section.

## Never

- Stack multiple unrelated issues into one PR.
- Claim verification that was not performed.
- Ignore a client PR template when one exists.
- Treat the PR body as proof; the diff and the checks remain the source of truth.
