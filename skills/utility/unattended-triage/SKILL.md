---
name: unattended-triage
description: Decide an issue's category and state and draft the outcome comment (Agent Brief, ready-for-human structure or Triage Notes) for the caller to post. Use when triaging a single issue with nobody available to answer live. Adapted from the triage skill in mattpocock/skills (MIT, see CREDITS.md in this repository).
---

# Unattended triage

Decide category and state for one issue and produce the outcome comment. Does not post to GitHub; the caller owns every GitHub write.

## Contract

See **Contracts** in the protocol for what each key means. This skill returns a document and writes nothing: the caller posts the comment. `returns` lists the lines of that document, and the first is the recommended state.

```yaml
kind: utility
params: [subject]
used_by: [triage-github-issue]
requires:
  - "`subject` names one issue, with its title and body."
returns:
  - "Recommended state: ready-for-agent | ready-for-human | needs-info"
  - "Category: bug | enhancement"
  - "Comment structure: Agent Brief | ready-for-human structure | Triage Notes"
  - "Outcome comment: <the comment the caller posts, in that structure>"
  - "Proposed repository changes: None | <GLOSSARY.md, ADR or .out-of-scope/ changes, as text>"
ensures:
  - "The structure follows the state: an Agent Brief for ready-for-agent, the ready-for-human structure (the brief plus why it cannot be delegated) for ready-for-human, and Triage Notes for needs-info."
  - "An issue with an open question is needs-info, never ready-for-agent. Open questions are put in the comment, and nobody is waited for."
  - "An enhancement whose use case is not stated is needs-info, never ready-for-agent."
  - "A wontfix recommendation is ready-for-human, and the comment says why. The issue is never closed."
  - "Proposed GLOSSARY.md, ADR or .out-of-scope/ changes are text in the proposal line, never edits."
effects:
  reads: ["the issue, its comments and the duplicate and related findings the caller gives", "the codebase", "GLOSSARY.md, the ADRs and .out-of-scope/, when the repository has them"]
  writes: {}
never:
  - "Post a comment, apply a label or close an issue. The caller does that."
  - "Assume the answer to an open question."
calls: [grill-via-github-comments]
idempotent: "It only reads and writes text, so triaging the same issue again gives the same kind of outcome and changes nothing on GitHub."
terminates: "A single pass over one issue, with at most one round of questions."
```

## Inputs

**Free text.** The issue to triage: number, URL, title and body, plus any duplicate/related findings and gaps the caller already found.

**Key-value pairs.** Optional.

| Input | Default | What it does |
|---|---|---|
| `subject` | *(from free text)* | The issue under triage |

**Implicit dependencies.** This skill also needs the `grill-via-github-comments` skill (through the Skill tool), the codebase itself, and, when the repository has them, `GLOSSARY.md`, the ADRs and `.out-of-scope/`. It needs no GitHub access of its own: the caller owns every GitHub call, and this skill only reads, thinks and writes text.

## Process

1. Read the issue and related context.
2. Check for duplicates, prior rejections, and existing implementations.
3. Question what is still open. If the request needs fleshing out, call the Skill tool with `grill-via-github-comments` and put the round it returns into the comment. Do not wait for answers.
4. Choose category (`bug` or `enhancement`) and state (`ready-for-agent`, `ready-for-human`, or `needs-info`). Any open question, or an enhancement with no stated use case, is `needs-info`. A wontfix recommendation is `ready-for-human`: say why, and do not close the issue.
5. Write the outcome comment in the structure the state needs and return it with the category and any proposed repository changes. Post nothing.
