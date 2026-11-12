---
"github-agent-workflow": minor
---

`npm run eval -- <skill>/<scenario> --model <model>` runs a model through a skill against the `gh` simulator and judges what it did with the scenario checker. It reports a pass, a deviation from the scenario's golden, or a violation of the skill's contract, with the diff of effects and the skills the model called. It is opt-in (it needs `ANTHROPIC_API_KEY` and costs money), capped by `--max-runs`, `--max-tokens` and `--max-turns`, never part of CI, and keeps transcripts in the git-ignored `.eval/`.
