---
name: grill-via-github-comments
description: Work out everything that must be decided before a plan, request or issue can be acted on, and draft every question that is ready to ask as one round, each with a recommended answer, for the caller to post. Use when nobody is available to answer live, for example when refining an issue during an automated run. Adapted from the grilling skill in mattpocock/skills (MIT, see CREDITS.md in this repository).
---

# Grill via GitHub comments

Interview-by-comment. A live grilling session asks a round, waits for answers, then asks the next. Nobody is there to answer, so this skill does the thinking up front, asks **one** round, and stops. The answers arrive later, from a human, and a later run continues from them.

Map the subject as a **design tree**: every decision branches into the decisions that hang off it.

## Contract

See **Contracts** in the protocol for what each key means. This skill returns a document and writes nothing: the caller puts the round in a comment. `returns` lists the lines of that document, and the first is the outcome.

```yaml
kind: utility
params: [subject]
used_by: [unattended-triage]
requires:
  - "`subject` is a request, a plan or an issue."
returns:
  - "Outcome: asked | nothing to ask"
  - "Questions: <the round, each question in the Format with its recommended answer> | None"
  - "Waiting on those answers: <the decisions that depend on them> | None"
  - "Findings: <what was looked up instead of asked> | None"
ensures:
  - "One round only: the skill asks once and stops. Nobody is waited for."
  - "Every question has a recommended answer."
  - "Every decision on the frontier (open, with its prerequisites settled) is asked in that round, and a decision with an open prerequisite is not."
  - "No question asks for something the skill could look up in the code, the docs or the issue history. The answer is a finding instead."
  - "Decisions left for a later round are named under `Waiting on those answers`, and that line is `None` only when nothing waits."
  - "The outcome is `nothing to ask` exactly when there are no questions."
effects:
  reads: ["the subject", "the code, the docs and the issue history, to find facts"]
  writes: {}
never:
  - "Post a comment, apply a label or act on an open decision. The caller does that."
  - "Assume the answer to an open decision."
  - "Ask a second round, or wait for answers."
calls: []
idempotent: "It only reads and writes text, so questioning the same subject again asks the same round and changes nothing."
terminates: "A single round. The frontier is asked once, and the skill stops."
```

## Inputs

**Free text.** The subject to question: the request, the plan or the issue. Everything in it is context for the questions, not a second instruction.

**Key-value pairs.** `key=value` on a line of its own. Recognised keys, all optional except `subject`:

| Input | Default | What it does |
|---|---|---|
| `subject` | *(required)* | What the questions are about |

**Implicit dependencies.** None. This skill is pure reasoning over the subject and the repository, so a runner with a shell has no advantage here. It reads no GitHub state, applies no labels and posts nothing.

## Process

1. **Find the facts yourself.** Read the code, the docs, the issue history. Never ask for anything you could look up. If your runner has sub-agents, send them to find facts in parallel.
2. **Build the tree** of open decisions. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask now without guessing at answers you have not heard.
3. **Ask the whole frontier in one round.** Number each question and give your recommended answer. A question that depends on another question still open belongs to a later round, so leave it out and say that later questions exist.
4. **Stop.** Do not act on the open decisions, and do not assume their answers. Return the round, the decisions that wait on it, and what you looked up instead of asking.

## Format

```
❓ **Q1** - **<question title>**: <question body, possibly several paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body>

➡️ <your recommended answer>
```
