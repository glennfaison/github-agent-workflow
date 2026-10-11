# Writing Agent Briefs

Adapted from the triage skill in [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, see CREDITS.md in this repository).

An agent brief is a structured comment posted on an issue when it moves to `ready-for-agent`. It is the authoritative specification that an unattended agent will work from. The original body and discussion are context: the brief is the contract.

## Principles

### Durability over precision

The issue may sit in `ready-for-agent` for days or weeks. The codebase will change in the meantime. Write the brief so it stays useful as files are renamed, moved or refactored.

- **Do** describe interfaces, types and behavioural contracts.
- **Do** name specific types, function signatures or config shapes the agent should look for or modify.
- **Don't** reference file paths or line numbers: they go stale.
- **Don't** assume the current implementation structure will remain the same.

### Behavioural, not procedural

Describe **what** the system should do, not **how** to implement it. The agent explores the codebase fresh and makes its own implementation decisions.

- **Good:** "The `SkillConfig` type should accept an optional `schedule` field of type `CronExpression`."
- **Bad:** "Open src/types/skill.ts and add a schedule field on line 42."

### Complete acceptance criteria

The agent needs to know when it is done. Every brief has concrete, independently verifiable acceptance criteria.

- **Good:** "Running `gh issue list --label needs-triage` returns issues that have been through initial classification."
- **Bad:** "Triage should work correctly."

### Explicit scope boundaries

State what is out of scope. This stops the agent gold-plating or assuming things about adjacent features.

## Template

```markdown
## Agent Brief

**Category:** bug / enhancement
**Summary:** one-line description of what needs to happen

**Current behavior:**
What happens now. For bugs, the broken behaviour. For enhancements, the status quo the feature builds on.

**Desired behavior:**
What should happen once the work is done. Be specific about edge cases and error conditions.

**Key interfaces:**
- `TypeName`: what needs to change and why
- `functionName()` return type: what it returns now vs what it should return
- Config shape: any new configuration options needed

**Acceptance criteria:**
- [ ] Specific, testable criterion 1
- [ ] Specific, testable criterion 2

**Out of scope:**
- Thing that should NOT be changed in this issue
- Adjacent feature that might seem related but is separate
```

## A good brief (bug)

```markdown
## Agent Brief

**Category:** bug
**Summary:** Skill description truncation drops mid-word, producing broken output

**Current behavior:**
When a skill description exceeds 1024 characters, it is cut at exactly 1024 characters regardless of
word boundaries, so descriptions end mid-word.

**Desired behavior:**
Truncation breaks at the last word boundary before 1024 characters and appends "...".

**Key interfaces:**
- The `SkillMetadata` type's `description` field: no type change, but the logic that populates it
  must respect word boundaries.

**Acceptance criteria:**
- [ ] Descriptions under 1024 chars are unchanged
- [ ] Longer descriptions end at the last word boundary, followed by "..."
- [ ] The total length including "..." does not exceed 1024 chars

**Out of scope:**
- Changing the 1024 char limit itself
```

## A bad brief

```markdown
## Agent Brief

**Summary:** Fix the triage bug

**What to do:** The triage thing is broken. Look at the main file and fix it.
The function around line 150 has the issue.

**Files to change:**
- src/triage/handler.ts (line 150)
```

Bad because it has no category, a vague description, stale-prone paths and line numbers, no acceptance criteria, no scope boundaries, and no current-versus-desired behaviour.
