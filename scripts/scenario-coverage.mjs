// Reports which of each skill's declared results no scenario exercises.
//   npm run scenarios:coverage
// The same numbers are enforced by tests/scenarios.test.mjs: a skill cannot declare a result line
// that no scenario exercises.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { extractContract } from "./contracts.mjs";
import { matchesReturn, parseDocLine, docHead, ORACLES } from "./scenario.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(PKG, "skills");
/** Every skill directory in the package, by name: `skills/<bucket>/<skill>`. */
const skillDirs = () => readdirSync(SKILLS, { withFileTypes: true }).filter((b) => b.isDirectory()).flatMap((b) =>
  readdirSync(join(SKILLS, b.name), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SKILLS, b.name, d.name, "SKILL.md")))
    .map((d) => ({ name: d.name, dir: join(SKILLS, b.name, d.name) })));
/** The parsed contract of a skill, or null when it has none (yet) or is not a skill of this package. */
export function contractOf(name) {
  const found = skillDirs().find((s) => s.name === name);
  const block = found && extractContract(readFileSync(join(found.dir, "SKILL.md"), "utf8"));
  return block ? parse(block.yaml) : null;
}
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
    if (!c || c.kind === "group" || c.kind === "reference") continue; // a group's results are its items' results; reference material is never run
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
