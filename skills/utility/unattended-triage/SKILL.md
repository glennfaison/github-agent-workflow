---
name: unattended-triage
description: Decide an issue's category and state and write the outcome comment (Agent Brief, ready-for-human note or Triage Notes). Use when triaging a single issue with nobody available to answer live. Adapted from the triage skill in mattpocock/skills (MIT, see CREDITS.md in this repository).
---

# Unattended triage

Decide category and state for one issue and produce the outcome comment. Does not post to GitHub; the caller owns every GitHub write.

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
4. Choose category (`bug` or `enhancement`) and state (`ready-for-agent`, `ready-for-human`, or `needs-info`).
5. Write the outcome comment the caller will post.

## Never

- Post comments, apply labels, or close issues (the caller does that).
- Assume answers to open questions.
