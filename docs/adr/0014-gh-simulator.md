# 0014. A `gh` simulator answers from a world file

## Status

Accepted and built: the read paths (#86), the write paths (#87), and `api`, fault injection and the replacement of the old stub in `tests/lib.test.sh` (#88).

## Context

ADR 0012 checks a scenario against a skill's contract, and `diffWorlds` turns the change a run left behind into the effects the checker takes. What was missing is something to run a skill against. A maintainer who wants to see whether a model follows `shepherd-github-pr` has to point it at a real repository, cannot repeat the run, and cannot make a merge fail or a check hang.

`tests/lib.test.sh` had a stub `gh` for the shell helpers. It covered only what `lib.sh` calls, and it ignored which `--json` fields are asked for. That let `prs_for_issue` ask `gh` for a field it does not have (#89).

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

### `api` (#88)

`gh api` answers the nine REST calls the package makes, and refuses everything else as `unsupported` (graphql, another method on a path, `-F @file`, `--input`):

| call | answered from |
| --- | --- |
| `GET user` | the world's agent login |
| `GET repos/{owner}/{repo}/issues/N/comments` | the item's comments (an issue's or a PR's), as REST comments with `author_association`, `user.login` and `updated_at` |
| `PATCH repos/{owner}/{repo}/issues/comments/ID -f body=` | edits a stored comment in place |
| `GET .../pulls/N/files` | the PR's `files` (a rename is `{path, previous}`, which gives `previous_filename`) |
| `GET .../contents/PATH?ref=` | the world's `files` (raw with the raw `Accept` header, otherwise a base64 object) |
| `GET .../git/trees/HEAD?recursive=1` | the paths of the world's `files` |
| `GET .../pulls?state=&per_page=&page=` and `GET .../pulls/N` | the world's PRs as REST pull requests, newest first. `author_association` is the PR's `association` (default `NONE`) |
| `PUT .../pulls/N/update-branch -f expected_head_sha=` | gives a `BEHIND` PR a new head and makes it `CLEAN`. A stale sha, a conflict and a PR that is not behind are 422, as on GitHub |

- **A comment edited in place is an effect.** Since the lease comment of a step is edited rather than added, the checker's effect model gained `comment_edit` (the comment's index and its new text), scoped like `comment`. `diffWorlds` reads an edited comment as one, and `applyEffects` makes it.
- **A comment the simulator derives from a world field (a `lease`, a `readySha`) cannot be edited.** There is no stored comment to change, so the call is `unsupported` and `claim` falls back to posting a comment, as it does when an edit fails.
- **Pagination is not modelled** beyond `per_page` and `page` on the PR list. `--paginate` returns a list whole.

### Faults (#88)

A world (and so a scenario's `world:`) may carry `faults: [{match, fail, exit?, before?, times?}]`.

- A call that starts with `match` (whole words: `pr merge`, `api -X PATCH`, `api user`) fails with the message `fail` and the exit code `exit` (default 1), writes nothing, and is logged with `kind: "fault"`, the index of the fault and a `faultId`.
- `before` is a list of effects applied to the world first. With `fail` it is a failure after something changed. Without `fail` the call goes on, which is how another run gets in ahead of this one (the creation race of `log_issue`). A scenario file is read-only, so `before` needs a world file.
- `times` limits how often a fault fires. Firing is counted in the log, under the fault's definition (`faultId`, a hash of it), so `times` needs `GH_SIM_LOG`. A different fault that is later at the same place in the list starts fresh, and the same fault written again does not.
- Faults are configuration, not state: they are the same in the world a run starts from and the one it leaves, so `diffWorlds` does not see them, and a scenario that carries them is judged as it was (tested on every golden scenario).

### One mock (#88)

`tests/lib.test.sh` runs against this simulator and nothing else. It sets a world up with a small `w` (jq over the world file) and a few helpers, runs the functions under test, and reads the result back through `gh`. The old stub is gone. Making the tests as strict as `gh` showed three things the stub let through: the `authorAssociation` field (#89), a repository with a label catalog refuses labels it does not have (the tests now start from the catalog `setup-github-agent-workflow` leaves), and issues and PRs share one number sequence (so a log issue made after PRs 70 to 74 is number 75). The last test of the file fails if any call in the run was `unsupported`, so a helper that swallows the failure of a call the simulator does not cover is still noticed.

## What it does not do

- **It is not GitHub.** Rate limits, pagination, webhooks, merge queues, branch protection and reviews are not modelled. A merge is blocked by the merge state a world gives, nothing else. Some error messages are what `gh` prints and some are close to it (a merge of a closed PR, an unreadable body file).
- **Some world fields cannot be shown.** `entries`, `kind`, `openQuestions`, `useCase` and `wontfix` stand for facts a model would read from prose (a log entry, a body), not for GitHub state. `seed.mjs` says which ones a world has. A scenario that depends on them needs a runner to write the prose (#61).
- **A world has no branch names, check names or logs.** A PR is on `feat/<closed issue>-pr-<N>`, which matches the pattern `prs_for_issue` reads, unless it names a `branch`. A check is `check-<i>`. The log of a failing run is one fixed line.
- **Its field lists are a copy.** They come from one `gh` version and can fall behind.
- **It is slow next to a shell function.** Each call starts Node (about 75 ms, half of it loading `yaml` through the checker). `tests/lib.test.sh` makes about 390 calls and takes about 45 seconds, where the stub took 10. A compile cache saved little (12 ms a call), so it is not used.

## Where the simulator and the skills disagree

Following `gh` exactly shows two places where the package assumes something `gh` does not do.

- `lib.sh` asked for `authorAssociation` on a PR, which is not a PR field in any `gh` release. Fixed in #89, which the simulator made visible.
- The shepherd skill's check-state one-liner expects `gh pr checks N --json bucket` to print `[]` for a PR with no checks, and so to answer `no-checks-yet`. `gh` instead exits 1 with `no checks reported on the '<branch>' branch` and prints nothing. The skill also says the exit code is non-zero while checks run, which is true without `--json` (8 while pending) and false with it (always 0). The simulator does what `gh` does, and a test records the difference.
