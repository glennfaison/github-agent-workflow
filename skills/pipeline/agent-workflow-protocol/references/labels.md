# Labels

Single source of truth for every label the workflow reads or writes. If a skill disagrees with this file, this file wins.

## Conventions

- `agent:*` labels belong to this workflow.
- The flat labels belong to the triage skill: the states `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, and the categories `bug` and `enhancement`. Keep their names exactly. The workflow itself only ever **sets** `needs-info`, `ready-for-agent` and `ready-for-human`. Grooming applies the category when it sets the final state, and removes `needs-triage` if present. The workflow never applies `wontfix`.
- Two kinds of label:
  - **Lease**: "an agent is working on this right now." Temporary. Expires (see `../SKILL.md`).
  - **State**: "where this item is in its life." Durable. Changed only as part of a transition below.
- An issue carries at most one of `needs-info`, `ready-for-agent`, `ready-for-human`, `agent:pr-open`. (`needs-triage` is transient and means a Grooming pass did not finish, so the issue stays eligible.) A PR carries at most one of `agent:needs-work`, `agent:ready-for-review`. Change state with one command that removes the old label and adds the new one: `gh issue edit N --remove-label OLD --add-label NEW`.
- An issue with **no state label** is untouched and eligible for Grooming. That includes an issue a human has just taken out of `needs-info`.
- Exploring applies **no labels**.

## The labels

| Label | On | Kind | Meaning | Added by | Removed by |
|---|---|---|---|---|---|
| `agent:triage` | issue | lease | Grooming is working on it | Grooming | Grooming, always, even on failure |
| `agent:in-progress` | issue, PR | lease | Implementing is coding the issue, or Shepherding/Reviewing is working on the PR | the working step | the same step, always |
| `needs-info` | issue | state | An agent asked questions; waiting for a human | Grooming, Implementing (bail-out) | **A human**, after answering. No step ever removes it |
| `ready-for-agent` | issue | state | An agent can implement this from the issue plus the codebase | Grooming | Implementing, when the PR is open |
| `ready-for-human` | issue | state | Needs a human | Grooming, Implementing (bail-out) | a human |
| `agent:pr-open` | issue | state | A PR for this issue is open | Implementing | Reviewing on merge. Grooming's housekeeping if every PR was closed unmerged (replaced by `ready-for-human`) |
| `agent:needs-work` | PR | state | Not reviewable yet: checks failing, checks unfinished, or review findings open | Implementing, Reviewing | Shepherding, when it posts the ready handoff |
| `agent:ready-for-review` | PR | state | Checks are green and the handoff is posted | Shepherding | Reviewing |
| `agent:stuck` | issue, PR | escalation | An agent gave up; a human must act. Every step ignores it | `escalate.md` | a human |
| `agent:log` | issue | meta | Monthly run-log issue. Every step ignores it | first run of the month | never |

## Transitions

Each row happens inside a lease held by the step named.

| Item | From | Step | To |
|---|---|---|---|
| Issue | (no state label), or `needs-triage` | Grooming | `needs-info`, `ready-for-agent`, `ready-for-human`, or closed as a duplicate |
| Issue | `needs-info` | a human removes the label after answering | untouched, so Grooming picks it up again |
| Issue | `ready-for-agent` | Implementing | `agent:pr-open`, and the new PR gets `agent:needs-work`. If a PR for the issue already exists, no new PR is made (see the `implement-github-issue` skill) |
| Issue | `ready-for-agent` | Implementing (bail-out) | `needs-info` or `ready-for-human` |
| Issue | `agent:pr-open`, every PR closed unmerged | Grooming (housekeeping) | `ready-for-human` |
| Issue | `ready-for-agent` or `agent:pr-open`, a PR already merged | Implementing or Grooming | closed |
| PR | `agent:needs-work` | Shepherding | pushes a fix and stays `agent:needs-work`, or becomes `agent:ready-for-review` |
| PR | `agent:ready-for-review` | Reviewing | merged (its issue is then closed and loses `agent:pr-open`), or `agent:needs-work` (with or without a fix pushed) |
| Issue or PR | any | any step | `agent:stuck` |

## Setup (run once)

```bash
gh label create "agent:triage"           --color FBCA04 --description "Grooming in progress (lease)" --force
gh label create "agent:in-progress"      --color FBCA04 --description "Agent working on this now (lease)" --force
gh label create "agent:pr-open"          --color 0E8A16 --description "Issue has an open PR" --force
gh label create "agent:needs-work"       --color D93F0B --description "PR not yet reviewable" --force
gh label create "agent:ready-for-review" --color 0E8A16 --description "PR ready for agent review" --force
gh label create "agent:stuck"            --color B60205 --description "Agent gave up; human needed" --force
gh label create "agent:log"              --color C5DEF5 --description "Agent run log" --force
# The triage skill's labels. These commands fail harmlessly if the labels already exist.
gh label create "needs-info"       2>/dev/null
gh label create "ready-for-agent"  2>/dev/null
gh label create "ready-for-human"  2>/dev/null
```
