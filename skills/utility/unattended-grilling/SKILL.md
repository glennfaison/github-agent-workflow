---
name: unattended-grilling
description: Work out everything that must be decided before a plan, request or issue can be acted on, and write every question that is ready to ask as one round, each with a recommended answer. Use when nobody is available to answer live, for example when refining an issue during an automated run. Adapted from the grilling skill in mattpocock/skills (MIT, see CREDITS.md in this repository).
---

# Unattended grilling

Interview-by-comment. A live grilling session asks a round, waits for answers, then asks the next. Nobody is there to answer, so this skill does the thinking up front, asks **one** round, and stops. The answers arrive later, from a human, and a later run continues from them.

Map the subject as a **design tree**: every decision branches into the decisions that hang off it.

## Process

1. **Find the facts yourself.** Read the code, the docs, the issue history. Never ask for anything you could look up. If your runner has sub-agents, send them to find facts in parallel.
2. **Build the tree** of open decisions. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask now without guessing at answers you have not heard.
3. **Ask the whole frontier in one round.** Number each question and give your recommended answer. A question that depends on another question still open belongs to a later round, so leave it out and say that later questions exist.
4. **Stop.** Do not act on the open decisions, and do not assume their answers.

## Format

```
❓ **Q1** - **<question title>**: <question body, possibly several paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body>

➡️ <your recommended answer>
```

## Result

Return the formatted round. Return `no open questions` only if the frontier is empty: every branch visited, nothing left silently assumed. Questions must be specific and answerable. "Please provide more detail" is not a question.
