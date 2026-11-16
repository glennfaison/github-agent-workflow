---
"github-agent-workflow": patch
---
`_agent_self` no longer puts an error into the trusted logins. For a GitHub App's installation token `gh api user` is a 403, and `gh` still prints the error body on stdout, so `lib.sh` took `{"message":"Resource not accessible by integration",...}` as the agent's login and split it into the list of trusted authors. It now uses the output only when the call succeeds and the output is a login (`name` or `name[bot]`), and otherwise the agent is unknown. The protocol now says how to check that `gh` works (`gh repo view`, not `gh auth status` or `gh api user`, which an App token fails while still reading and writing), and that a `trusted_authors` login is matched whole, with `[bot]` for an App, so `*` matches nothing.
