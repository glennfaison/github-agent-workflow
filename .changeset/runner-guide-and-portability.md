---
"github-agent-workflow": minor
---

Add `docs/RUNNERS.md` (what a scheduler needs, prompts for runners that cannot load skills, a starting cadence). Add `APP_URL` to the config: Exploring uses it when the prompt gives no URL, and explores the code only when there is none, instead of stopping. `implement-github-issue` and `review-github-pr` now use `$PR_BASE_BRANCH` instead of naming `develop` or `main`, `issue-format.md` no longer lists one product's areas, and the docs name Python 3, not GNU `date`, as the date requirement. `pipeline-guide` gains a lifecycle diagram. The validator rejects hard-coded branch names in skills.
