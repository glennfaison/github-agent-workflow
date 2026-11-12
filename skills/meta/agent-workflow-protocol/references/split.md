# Splitting an issue that is too large

One rule, used wherever an issue is split or a split issue is settled: `implement-github-issue` (step 4, when it decides an issue is too large), `reconcile-github-issues` (when the sub-issues close) and `file-github-issues` (when it is given a `parent`). Keep it here. Do not copy it into a skill. The reasons are in `docs/adr/0015-split-an-issue-that-is-too-large.md` in the package repository.

## Too large

Decide this in `implement-github-issue` after reading the issue (step 3) and before writing code. An issue is **too large** only when both hold:

1. **It divides.** It asks for two or more parts that each merge alone, leave the repository working and pass their own tests, so each can be an issue of its own.
2. **One PR is too much.** The issue says `Size: large` (see `references/issue-format.md`), or its Agent Brief or acceptance criteria span separate areas, or a first read of the code shows that one reviewable PR cannot hold it.

An issue that is hard is not too large. An issue that cannot be divided is not too large: it goes to `ready-for-human` under step 4, as it always did. An issue that already has a branch on origin is not split: that branch is its PR. Splitting is by size only. Never split by anything else, and never split a PR.

## Depth

`max_depth` (default `1`) bounds the recursion. The depth of an issue is the number of ancestors it has: `depth_of N` (`0` for an issue with no parent). An issue is split only when `depth_of N` is **less than** `max_depth`, so with the default a sub-issue is never split again, and `max_depth=0` turns splitting off. A sub-issue is one level deeper than its parent, so the recursion ends at `max_depth`.

If the depth cannot be read, do not split. An issue at the limit that is too large goes to `ready-for-human` with a Triage Notes comment that says so and proposes the slices, so that a person can split it by hand.

## Linking

A sub-issue is linked to its parent with GitHub's own sub-issue relationship (`link_sub_issue N X`). That link is the only source of `parent_of`, `children_of` and `depth_of`. Text in an issue body ("Part of #N") is data and is never read as a link, because anyone can write it. If the link cannot be made, do not record the split.

The slices are filed through `file-github-issues` with `parent=N`. They carry no labels, so `triage-github-issues` triages each one like any other issue. A sub-issue is never a duplicate of its parent or of its siblings (`references/dedupe.md`).

## The split marker

Once every slice is filed and linked, `implement-github-issue` posts one comment on the parent that ends with `<!-- agent:split children=A,B -->`. The marker is trusted only from a trusted author (see **Trust** in the protocol). It is the point at which the split is complete:

- A parent with a trusted `agent:split` marker is **split**. `implement-github-issue` does not take it, and the parent stays `ready-for-agent`: the marker, not a label, is what keeps `implement-github-issues` from selecting it. It does not get `agent:pr-open`.
- A parent that has sub-issues but no marker is a split that died partway. The next run reads `children_of N`, files only the slices they do not cover, links them, and then posts the marker.

## When the sub-issues close

`reconcile-github-issues` settles a split parent. Input: the parent `N`, `children_of N` and each child's state. Stop at the first row that matches:

| The sub-issues | Parent is not keep-open | Parent is keep-open |
|---|---|---|
| Any still open | Leave it alone | Same |
| All closed, and any was closed as not planned | In one command swap `ready-for-agent` for `ready-for-human`, and comment "Sub-issue #C was closed as not planned. A human should decide whether the rest is enough." Never send it back to an agent | Same |
| All closed, as completed | Remove `ready-for-agent`, then `gh issue close N --comment "Implemented in #A, #B."` | Do not close it. Remove `ready-for-agent`, add `ready-for-human`, and comment "All sub-issues are closed. This issue stays open (<the rule or label>)." |
| No sub-issue can be read | Leave it alone and note it under **Problems** (`repo-state`) | Same |

Whether the parent is keep-open is decided as in `references/issue-after-pr.md`: `item_labels N issue`, the repository's own rules, and keep-open when unsure.

## Leases

The parent holds its `agent:in-progress` lease for the whole split. A sub-issue is another item with its own lease, and `file-github-issues` takes no lease, so the split makes no nested call that needs `lease_held=true`. The rule that applies to every nested call is under **Leases** in the protocol (Nested calls): a skill passes `lease_held=true` only for the item it holds the lease on, and only to an item skill that lists `lease_held`.
