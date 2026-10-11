# Out-of-scope knowledge base (read-only for agents)

Adapted from the triage skill in [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, see CREDITS.md in this repository).

A repository may keep `.out-of-scope/`: one file per rejected **concept**, not per issue. It records why a feature request was rejected and lists every issue that asked for it. It gives institutional memory, and it lets triage notice that a new request repeats an old one.

```
.out-of-scope/
├── dark-mode.md
└── plugin-system.md
```

## Agents only read it

During triage, read every file in `.out-of-scope/` and compare the new issue by **concept**, not keyword: "night theme" matches `dark-mode.md`. On a match, do not close or label anything. Recommend `ready-for-human`, quote the earlier decision and its reason, and ask whether it still holds. A human then confirms the rejection, reconsiders it, or decides the issues are different.

Agents never write to `.out-of-scope/`. When a rejection looks right, put the proposed file in the comment for a maintainer to commit.

## File format

A short design document, not a database row:

```markdown
# Dark Mode

This project does not support dark mode or user-facing theming.

## Why this is out of scope

The rendering pipeline assumes one palette defined at build time. Supporting several themes would need a
theme context around the whole tree, per-component style resolution, and a store for user preferences.
That is an architectural change that does not fit the project's focus.

## Prior requests

- #42: "Add dark mode support"
- #87: "Night theme for accessibility"
```

Name the file for the concept in kebab-case. Give a substantive, durable reason (scope, technical constraint, strategic choice), never a temporary one such as "we are too busy". That is a deferral, not a rejection.

## When it applies

Only to a **rejected enhancement**. Do not record a bug, and do not record something that is already implemented: that is a built feature, and recording it would poison later checks with false rejections. For an already-implemented request, the comment points to where the feature lives.
