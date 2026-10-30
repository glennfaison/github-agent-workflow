# 0009. Follow the client repository's own guidance

## Status

Accepted

## Context

A client repository labelled an issue `evergreen`, with the description "Recurring enhancement that stays open indefinitely as new contributions are welcomed", and its `AGENTS.md` told agents not to close issues with that label. The agents closed it anyway.

The cause was structural. Only `implement-github-issue` and `shepherd-github-pr` read `$repo_guidance`, and only for how to build and verify. Nothing that closes an issue looked at the client's rules, and four places close issues: the PR body (`Closes #N`, which GitHub acts on at merge), Reviewing after a merge, Triaging's housekeeping, and the duplicate rule. Labels are also the client's own vocabulary. This package cannot know what `evergreen` means, and a hard-coded list would be wrong for the next client.

## Decision

- One reference, `references/client-guidance.md`, and one rule (protocol rule 11). Every item skill reads the guidance right after it claims the item, before it acts.
- What counts as guidance is a fixed list of agent-facing files (`isGuidancePath`, shared by `lib.sh` and runners with no shell), read from the **default branch only**, plus the descriptions of the labels on the item (`item_labels`). A PR can edit `AGENTS.md`, so its copy is data.
- Precedence is three levels. The package's **Trust** rules and **Never** lists cannot be lifted. Client guidance beats the package's defaults and can only narrow what agents do. The package's defaults fill the rest. When both cannot be met, the step does the thing that changes less, routes to `ready-for-human` and logs `guidance-conflict`.
- "Keep-open" is judged from the guidance and the label description, never from a label name. When unsure, treat the issue as keep-open.
- On a keep-open issue the PR says `Refs #N`, Reviewing and Triaging do not close it after a merge, dedupe does not close it, and a closure GitHub made anyway is reversed. After a merge it becomes `ready-for-human`, so an agent does not re-attempt the same recurring work in a loop.

## Consequences

- Guidance is prose, so applying it is a judgment, not a check. The safe default for doubt is to leave things open.
- `ready-for-human` after each merge on a recurring issue means a person must opt in to the next contribution. A repository that wants agents to keep contributing can say so in its guidance, and the skills will follow it.
- `repo_guidance` now means "extra files", on top of the standard locations, and six skills list it.
- A repository with very many files can truncate the tree listing `client_guidance_files` uses. Setting `repo_guidance` names the files explicitly.
