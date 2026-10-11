# Bucketed layout, flat discovery through symlinks

Status: accepted

Skills are grouped into buckets (`skills/github-workflow/`, `skills/utility/`) so the package stays navigable as it grows. Kilo Code and similar harnesses discover skills one level deep, in a skills directory, and require `name` to match the directory name. A bucketed package therefore cannot be dropped into a skills directory as it is.

## Decision

- Ship the bucketed layout. `.claude-plugin/plugin.json` lists every skill by explicit path, so Claude Code does not need discovery.
- `scripts/link-skills.sh` links each skill into a skills directory as a relative symlink named after the skill. A consuming repo that vendors this package as a folder or submodule runs it and commits the links.
- Installers that copy skills (`npx skills`) flatten them themselves.
- `scripts/validate-skills.mjs` checks the manifest, names and references, so a renamed or missing skill is caught before release.

## Consequences

- The links must be refreshed after adding, renaming or removing a skill (`npm run link`). Dangling links are removed automatically.
- Symlinks are committed in the consuming repository, outside this package.
- Plugin installs by some tools drop symlinks. The package contains none: only the consuming repo does.
