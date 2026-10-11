# Credits

## mattpocock/skills

Parts of this package are adapted from [mattpocock/skills](https://github.com/mattpocock/skills), which is
released under the MIT License:

> MIT License
>
> Copyright (c) 2026 Matt Pocock
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction, including
> without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
> following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial
> portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
> LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
> EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
> IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
> USE OR OTHER DEALINGS IN THE SOFTWARE.

What was adapted, and from where:

| Here | Adapted from |
|---|---|
| `skills/utility/unattended-triage/` (the triage roles, verification, outcomes, Triage Notes, `AGENT-BRIEF.md`, `OUT-OF-SCOPE.md`) | `triage` |
| `skills/utility/unattended-grilling/` (the design tree, the frontier, the question format) | `grilling` |
| The implementation loop in `implement-github-issue` (test-first at seams, typecheck often, full suite once, review before finishing) | `implement` |
| The explicit "Call the Skill tool with" convention, and the rule that shared files live in the skill that owns them | `.agents/invocation.md` |
| The package layout, plugin manifests, `scripts/link-skills.sh` idea and the release setup | the repository's own structure |

The adaptations make the originals runnable with no human present: one round of questions instead of a
live interview, no repository edits, and a recommendation to a human instead of closing issues.
