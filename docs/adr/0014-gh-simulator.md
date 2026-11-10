# 0014. A `gh` simulator answers from a world file

## Status

Accepted. The read paths (#86) and the write paths (#87) are built. `api`, fault injection and the replacement of the stub in `tests/lib.test.sh` (#88) follow, and this record is updated with each.

## Context

ADR 0012 checks a scenario against a skill's contract, and `diffWorlds` turns the change a run left behind into the effects the checker takes. What was missing is something to run a skill against. A maintainer who wants to see whether a model follows `shepherd-github-pr` has to point it at a real repository, cannot repeat the run, and cannot make a merge fail or a check hang.

`tests/lib.test.sh` has a stub `gh` for the shell helpers. It covers only what `lib.sh` calls, and it ignores which `--json` fields are asked for. That let `prs_for_issue` ask `gh` for a field it does not have (#89).

## Decision

`tests/sim/bin/gh` is an executable that a runner puts first on `PATH`. It answers `gh` calls from a world file and appends each call to a log.

- **The world file is the scenarios' format.** `GH_SIM_WORLD` is a bare world or a scenario file (its `world:` is read, with the label catalog expanded). The simulator reads a scenario file as it is. It will never write to one, so a run starts from a copy made by `node tests/sim/seed.mjs`.
- **Every call is logged**, supported or not: `{ts, argv, exit, kind}` per line in `GH_SIM_LOG`, with `kind` one of `ok`, `error` and `unsupported`. A run that used a command the simulator does not cover is visible in its log, even when the skill swallowed the failure with `|| true`.
- **A command, flag or field that is not covered fails loudly.** It exits 1 with `unsupported: <what>`. `tests/sim/surface.mjs` lists every `gh` command the skills use as `supported`, `planned` or `out-of-scope`, and a test greps `skills/` and `scripts/` for `gh` calls and fails for one that is not listed. The `supported` entries must equal the simulator's handlers.
- **It follows `gh`, not the world's vocabulary.** `--json` fields are checked against the list `gh` has (copied from `gh` 2.80, `api/query_builder.go`), so a field `gh` rejects is rejected here with the same message, and a field `gh` has but the world cannot fill is `unsupported`. States are `OPEN`, `CLOSED` and `MERGED`. Labels are objects. A check's bucket is `pass`, `fail`, `pending`, `cancel` or `skipping`. `--jq` prints as `gh` does (a string raw, null as an empty line). Plain output, without `--json`, is what `gh` prints to a pipe.
- **State the world keeps is shown as the comments a repository would hold.** `lease: live|stale`, `readySha`, `openFindings` and `shepherdAttempts` are facts about an item, but `lib.sh` reads them as `<!-- agent:... -->` markers in comments, so the simulator shows them that way. They are views and are never stored back, so `diffWorlds` does not see them. A stored comment that already says the same thing stands in for the derived one.

### Read paths (#86)

`issue list|view`, `pr list|view|checks`, `label list`, `repo view`, `auth status` and `run view --log|--log-failed`, with `--json`, `--jq`, `--label`, `--state`, `--limit`, `--search` and `-R`. `--search` matches every word in the title or body, and `closed:>=DATE`. It is not GitHub's search.

### Write paths (#87)

`issue edit|close|create|comment|reopen`, `pr edit|create|comment|merge` and `label create`, with the flags the skills use: `--add-label`, `--remove-label`, `--add-reviewer`, `--title`, `--body`, `--body-file` (a path, or `-` for stdin), `--reason`, `--comment`, `--label`, `--base`, `--head`, `--draft`, `--match-head-commit`, `--squash|--merge|--rebase`, `--delete-branch`, `--color`, `--description` and `--force`.

- **A write is an effect.** Each call is applied with `applyEffects`, the function the checker uses, so a run made of these calls is read back by `diffWorlds` as the effects it had, and `applyEffects(before, diffWorlds(before, after))` gives the world the run left (tested, and tested on the effects of every golden scenario made as `gh` calls). Two things the checker's effect model could not carry were added to it: a created item's title, body, creation time, author and branch travel in the `create_*` effect as `data`, and a `close` carries its `reason`.
- **A call is checked before it changes anything.** A failing call exits non-zero and never writes. The file is written whole, in its own format, through a temporary file and a rename, so it is never half written. A call that succeeds is the only one that saves.
- **It is refused like `gh` refuses it.** A label outside the catalog (`'x' not found`, only in a world that has a `labels` catalog), an empty comment, a missing `--title` or `--body`, a second open PR for the same branch, a merge without a method or with two, a merge pinned to a head that is not the head, a merge of a draft, of a PR that is `DIRTY`, `BEHIND` or `BLOCKED`, and an invalid `--reason`.
- **It never writes to a scenario file.** A write against one exits 2 and says how to make a world file (`seed.mjs`).
- **Written comments are the agent's own.** The author is the world's agent login (`user`, default `agent-bot`), the time is the call's clock, and the comment's marker is the first `<!-- agent:... -->` in its body. A comment the run just posted is therefore fresh: a ready handoff holds the merge lane.
- **A merge does not close the issue.** The skills settle an issue after its PR merges (`issue-after-pr.md`), with a keep-open rule that GitHub's own closing would hide, so the simulator leaves it open.
- **`issue reopen` is `unmodelled`.** No effect op reopens an item, so a run that reopens one needs a contract that allows it. Editing a title or body of an existing item is `unmodelled` as well.
- **A PR is created from the checkout.** Its branch is `--head` or the current git branch, and its commit is that branch's, so `gh pr create` runs in a git repository. The issues it closes are the existing ones its body names with a closing keyword.

## What it does not do

- **It is not GitHub.** Rate limits, pagination, webhooks, merge queues, branch protection and reviews are not modelled. A merge is blocked by the merge state a world gives, nothing else. Some error messages are what `gh` prints and some are close to it (a merge of a closed PR, an unreadable body file).
- **Some world fields cannot be shown.** `entries`, `kind`, `openQuestions`, `useCase` and `wontfix` stand for facts a model would read from prose (a log entry, a body), not for GitHub state. `seed.mjs` says which ones a world has. A scenario that depends on them needs a runner to write the prose (#61).
- **A world has no branch names, check names or logs.** A PR is on `feat/<closed issue>-pr-<N>`, which matches the pattern `prs_for_issue` reads, unless it names a `branch`. A check is `check-<i>`. The log of a failing run is one fixed line.
- **Its field lists are a copy.** They come from one `gh` version and can fall behind.

## Where the simulator and the skills disagree

Following `gh` exactly shows two places where the package assumes something `gh` does not do.

- `lib.sh` asks for `authorAssociation` on a PR, which is not a PR field in any `gh` release (#89).
- The shepherd skill's check-state one-liner expects `gh pr checks N --json bucket` to print `[]` for a PR with no checks, and so to answer `no-checks-yet`. `gh` instead exits 1 with `no checks reported on the '<branch>' branch` and prints nothing. The skill also says the exit code is non-zero while checks run, which is true without `--json` (8 while pending) and false with it (always 0). The simulator does what `gh` does, and a test records the difference.
