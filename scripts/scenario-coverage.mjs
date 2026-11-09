// Reports which of each skill's declared results no scenario exercises.
//   npm run scenarios:coverage
// The same numbers are enforced by tests/scenarios.test.mjs: a skill cannot declare a result line
// that no scenario exercises.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { PKG, skillDirs, contractOf } from "./skill-contracts.mjs";
import { matchesReturn, parseDocLine, docHead, ORACLES } from "./scenario.mjs";

export { contractOf };

/**
 * @returns {string[]} the scenarios of a skill with an eligibility oracle that completed a run (not `skipped`) and
 * have no `rerun`: what a second run would find is not said, and so not checked. An interrupted scenario has one.
 */
export function rerunGaps() {
  return Object.keys(ORACLES).flatMap((name) => {
    const dir = join(PKG, "tests/scenarios", name);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".yaml")).flatMap((f) => {
      const sc = parse(readFileSync(join(dir, f), "utf8"));
      const result = (sc.expect.results ?? [sc.expect.result]).filter(Boolean)[0] ?? "";
      return sc.expect.rerun === undefined && !/^#\d+ skipped/.test(result) ? [`${name}/${f}`] : [];
    });
  });
}
const scenariosOf = (name) => {
  const dir = join(PKG, "tests/scenarios", name);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => parse(readFileSync(join(dir, f), "utf8"))) : [];
};
/**
 * @returns {{name: string, total: number, missing: string[]}[]} one row per skill that is run and has a result to cover:
 * a pipeline skill's result lines, or a utility skill's verdicts (the alternatives of the first line of `returns`)
 */
export function coverage() {
  const rows = [];
  for (const { name } of skillDirs().sort((a, b) => a.name.localeCompare(b.name))) {
    const c = contractOf(name);
    if (!c || c.kind === "reference") continue; // reference material is never run
    if (c.kind === "group") { // what a group promises is its selection: a round that dispatches, and one with nothing to do
      const list = scenariosOf(name);
      const missing = [];
      if (list.length < 3) missing.push(`at least 3 scenarios (has ${list.length})`);
      if (!list.some((sc) => (sc.expect?.dispatches ?? []).length > 0)) missing.push("a scenario that dispatches");
      if (!list.some((sc) => (sc.expect?.dispatches ?? []).length === 0)) missing.push("a scenario with nothing eligible (no dispatch)");
      rows.push({ name, total: 3, missing });
      continue;
    }
    if (c.kind === "utility") {
      const first = parseDocLine(c.returns[0]);
      const verdicts = first.alts.filter((a) => !a.includes("<")).map(docHead);
      const seen = scenariosOf(name).map((sc) => docHead(sc.expect?.document?.[first.label] ?? ""));
      rows.push({ name, total: verdicts.length, missing: verdicts.filter((v) => !seen.includes(v)).map((v) => `${first.label}: ${v}`) });
      continue;
    }
    const results = scenariosOf(name).flatMap((sc) => (sc.expect.results ?? [sc.expect.result]).filter(Boolean).flatMap((r) => [r, r.replace(/^would: /, "")]));
    rows.push({ name, total: c.returns.length, missing: c.returns.filter((r) => !results.some((x) => matchesReturn(x, [r]))) });
  }
  return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let total = 0, covered = 0;
  for (const { name, total: t, missing } of coverage()) {
    total += t; covered += t - missing.length;
    console.log(`${name.padEnd(26)} ${String(t - missing.length).padStart(2)}/${t} results covered`);
    for (const m of missing) console.log(`    not covered: ${m}`);
  }
  console.log(`\n${covered}/${total} declared results have a scenario`);
  const gaps = rerunGaps();
  for (const g of gaps) console.log(`    no rerun: ${g}`);
  console.log(`${gaps.length} scenario(s) that completed a run have no \`rerun\``);
}
