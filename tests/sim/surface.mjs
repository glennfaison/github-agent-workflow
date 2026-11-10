// What the `gh` simulator covers. One entry per `gh` command the skills, the scripts and `lib.sh` use.
//
//   supported     the simulator answers it
//   planned       a later part of the simulator will answer it; today it exits `unsupported: <command>`
//   out-of-scope  the package deliberately does not use it, or the simulator will not model it
//
// tests/gh-sim.test.mjs greps skills/ for `gh` calls and fails for one that is missing here, so a new
// `gh` call in a skill is noticed. The list of `supported` entries must equal the simulator's handlers.

export const SURFACE = {
  "issue list": "supported",
  "issue view": "supported",
  "pr list": "supported",
  "pr view": "supported",
  "pr checks": "supported",
  "label list": "supported",
  "repo view": "supported",
  "auth status": "supported",
  "run view": "supported",

  "issue edit": "supported",
  "issue close": "supported",
  "issue create": "supported",
  "issue comment": "supported",
  "issue reopen": "supported",
  "pr edit": "supported",
  "pr create": "supported",
  "pr comment": "supported",
  "pr merge": "supported",
  "label create": "supported",
  api: "supported",

  // log.md tells agents never to look an issue up with search, so a skill calls it only to forbid it.
  search: "out-of-scope",
};

// The subcommands `gh` has, per command, so that prose such as "`gh auth` must succeed" is not read as
// the command "auth must". A command that is not listed here is matched on its own.
export const GH_SUBCOMMANDS = {
  issue: ["list", "view", "edit", "close", "create", "comment", "reopen", "delete", "develop", "lock", "pin", "status", "transfer", "unlock", "unpin"],
  pr: ["list", "view", "edit", "close", "create", "comment", "checks", "merge", "reopen", "ready", "review", "diff", "checkout", "status", "update-branch", "lock", "unlock"],
  label: ["list", "create", "edit", "delete", "clone"],
  run: ["list", "view", "watch", "rerun", "download", "cancel", "delete"],
  repo: ["view", "list", "create", "clone", "fork", "edit", "delete", "archive", "rename", "sync", "set-default", "deploy-key", "gitignore", "license", "unarchive"],
  auth: ["status", "login", "logout", "refresh", "token", "setup-git", "switch"],
};
const TOP_LEVEL = ["api", "search", "release", "workflow", "gist", "project", "secret", "variable", "cache", "codespace", "ruleset", "extension", "alias", "config", "browse", "status", "org", "attestation"];

/** The `gh` commands a text calls, as `issue list`, `api` or `search`. Only a command `gh` really has counts. */
export function ghCommandsIn(text) {
  const found = new Set();
  const re = /\bgh\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/g;
  for (const [, top, sub] of text.matchAll(re)) {
    if (GH_SUBCOMMANDS[top]) {
      if (sub && GH_SUBCOMMANDS[top].includes(sub)) found.add(`${top} ${sub}`);
    } else if (TOP_LEVEL.includes(top)) found.add(top);
  }
  return found;
}
