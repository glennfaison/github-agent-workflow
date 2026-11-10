---
"github-agent-workflow": patch
---

The `gh` simulator for tests now writes. `issue edit|close|create|comment|reopen`, `pr edit|create|comment|merge` and `label create` change the world file the way `gh` would and refuse what `gh` refuses (an unknown label, a merge pinned to the wrong head, a duplicate PR), leaving the file untouched when a call fails. A run's changes are read back by `diffWorlds`. For that, a `create_issue` or `create_pr` effect can carry the new item's title, body, creation time, author and branch as `data`, and a `close` effect its `reason`.
