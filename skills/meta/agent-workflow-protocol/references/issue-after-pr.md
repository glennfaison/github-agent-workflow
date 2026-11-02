# What an issue becomes once its PRs settle

One rule, used wherever an issue's state follows its PRs: `reconcile-github-issues` (every `agent:pr-open` issue), `implement-github-issue` step 2 (before it writes code) and `review-github-pr` step 7 (after its own merge). Keep it here. Do not copy it into a skill.

**Input:** an issue `N` and `prs_for_issue N`. First decide whether `N` is **keep-open**: `item_labels N issue`, and the repository's own rules (`references/client-guidance.md`). If you are unsure, treat it as keep-open.

Look at the PRs and stop at the first row that matches:

| The PRs | Issue is not keep-open | Issue is keep-open |
|---|---|---|
| Any `MERGED` (`#P`) | Remove `agent:pr-open` and `ready-for-agent` if the issue has them, then `gh issue close N --comment "Implemented in #P."`. A person may have merged it (`agent:human-merge`), and then no agent ran Reviewing's merge step that does this | Do not close it. Follow **After a merge** in `references/client-guidance.md` |
| None merged, any `OPEN` | The work is in review. Make the labels right: `agent:pr-open` present, `ready-for-agent` gone. Nothing else | Same |
| Only `CLOSED` (`#P`) | The work was abandoned. In one command swap `agent:pr-open` or `ready-for-agent` for `ready-for-human`, and comment "PR #P was closed without merging. A human should decide whether to retry." Never send it back to an agent: that is how the same fix gets re-attempted in a loop | Same |
| No PR at all | Nothing to settle. The caller decides what that means | Same |

**What a caller adds.**

- `reconcile-github-issues` leaves an `OPEN` issue alone, and notes "no PR at all" under **Problems** in the run log with the `repo-state` tag.
- `implement-github-issue` asks a different question on a keep-open issue: a `MERGED` PR there does not mean the work shipped, so it ignores `MERGED` PRs and goes by the other rows. "No PR at all" means it carries on and implements.
- `review-github-pr` has just merged PR `#N`, so for each issue it closes it is always the `MERGED` row.
