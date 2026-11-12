# 0015. An issue that is too large is split into sub-issues

## Status

Accepted

## Context

A maintainer files an issue that is clearly bigger than one PR. `implement-github-issue` cannot make it smaller. The most it could do was bail out to `needs-info` or `ready-for-human`, and a person had to split the issue by hand before the pipeline could continue.

ADR 0011 added `lease_held` so that a skill could call an item skill on an item it already holds, and noted what a skill that really recurses would also need: a depth bound, and children that cannot split again. Nothing used it. "A skill can call itself" was untested design.

Splitting is a good first use of recursion because the shape is natural. The parent files children, each child is an ordinary issue that the pipeline picks up on its own, and the only question is when to stop.

## Decision

**Trigger.** `implement-github-issue` decides that an issue is too large in step 4, after it has read the issue and before it writes code. Both must hold: the issue divides into two or more parts that each merge alone, and one PR is too much (`Size: large`, or separate areas, or a first read of the code). A hard issue is not too large, an indivisible one is not too large, and an issue with a branch already on origin is not split. Only size splits an issue. The rule is in `references/split.md`.

**Depth bound.** New input `max_depth`, default `1`. The depth of an issue is the number of its ancestors, read from GitHub's sub-issue links (`depth_of`). An issue is split only when its depth is less than `max_depth`. With the default a sub-issue is never split again, and `max_depth=0` turns splitting off. If the depth cannot be read, the issue is not split. An issue that is too large and at the limit goes to `ready-for-human` with its proposed slices, so a person can split it.

**Linking.** Slices are filed through `file-github-issues`, which takes a new `parent` input: the parent is never reported as a duplicate of a slice, and each filed body says `Part of #N.` for the reader. The link is GitHub's native sub-issue relationship, made by `implement-github-issue` with `link_sub_issue` after each `filed #X`. Native links need write access, so a stranger cannot forge one, which the text `Part of #N.` does not guarantee. A slice that is a duplicate of an issue that is not already a sub-issue of the parent is not linked, and the run fails instead of adopting someone else's issue.

**Result.** New result `#N split into #A, #B`. The parent stays open and keeps `ready-for-agent`. It does not get `agent:pr-open`, because no PR is open.

**Split marker.** After every slice is filed and linked, the parent gets one comment ending in `<!-- agent:split children=A,B -->`. A parent with a trusted marker is split, and `implement-github-issue` does not take it (a new `requires`), so a split parent does not use up the batch of `implement-github-issues`. A parent with sub-issues and no marker is a split that died partway, and the next run files only the slices that are missing before it writes the marker. The marker is the commit point.

**Closing.** `reconcile-github-issues` settles a split parent: every sub-issue closed as completed closes the parent (`#N closed: all sub-issues closed`), unless it is keep-open (`#N kept open: all sub-issues closed`). Any sub-issue closed as not planned sends the parent to `ready-for-human` (`#N ready-for-human: a sub-issue was closed as not planned`) and never back to an agent, as with an abandoned PR. An open sub-issue leaves the parent alone.

**Leases.** The parent holds `agent:in-progress` while it files. A call into an item skill on the same item passes `lease_held=true`. A call about any other item does not, because the caller does not hold that item's lease. The split makes no call of the first kind: the children are other items, and `file-github-issues` takes no lease. The rule is stated under **Leases** in the protocol (Nested calls) so that a later nested call is safe, and the scenario checker enforces it (see below).

**Termination.** Stated in the contract's `terminates`: a split happens only below `max_depth`, and a child is one level deeper than its parent. The checker also rejects any run that creates an issue deeper than `max_depth`.

**Checker.** A scenario may list the calls a run makes with their inputs (`calls: [{skill, target, inputs}]`). The checker rejects `lease_held=true` unless the caller claimed the lease on that item in this run (or was itself given `lease_held=true` for it), the call is about that same item, and the callee is an item skill that lists `lease_held`. It rejects a split below the depth limit, a split that is not recorded with the marker, an issue created under a parent that is not the split item, and a parent closed while a sub-issue is open. A group skill never passes `lease_held`, because it holds no lease.

## Alternatives considered

- **A new state label such as `agent:split`.** It would make the state visible on the board. It also adds a fifth label to the mutex set, to setup, to label repair and to the lifecycle diagram, and the marker plus the sub-issue links already hold the state. A person can see the sub-issues on the parent. Revisit if people look for split parents by label.
- **Linking by text in the body (`Part of #N`).** Anyone can write it, and a stranger could use it to hold a parent open. Rejected for linking and kept only as a human-readable line.
- **Recursion through `implement-github-issue` on each child.** The children are other items with their own leases and their own triage. Calling them directly would skip triage and make `lease_held` meaningless. They are picked up through the normal pipeline instead.
- **Closing the parent when all children are closed, whatever the reason.** A child that was rejected would then close a parent whose work was dropped, silently. The abandoned-PR rule (never send it back to an agent, let a person decide) is reused.

## Consequences

- New inputs `max_depth` (on `implement-github-issue` and `implement-github-issues`) and `parent` (on `file-github-issues`). New result lines on `implement-github-issue` and `reconcile-github-issues`. New helpers `parent_of`, `children_of`, `depth_of` and `link_sub_issue`, and a new marker `agent:split`.
- `implement-github-issue` gains a write scope, `other`: new issues, and a call to `file-github-issues`.
- Sub-issues need GitHub's sub-issue feature. A repository or runner without it cannot read depth, so it never splits, and behaves as it did before this change.
- A sub-issue that `triage-github-issue` rates `ready-for-human` or `needs-info` leaves its parent waiting. That is the intended place for a person to step in.
- A run that dies after filing a slice and before linking it leaves an unlinked issue. The next run finds it as a duplicate, and fails rather than adopting it. A person links it or closes it. This is rare, and the failure count escalates it.
- What this does not prove: the scenarios check that the contract, the checker and the expected outcomes agree. They do not show that a model judges "too large" well. The trigger is a judgement, written down so a reviewer can disagree with it.
