// Reports which of each skill's declared results no scenario exercises.
//   npm run scenarios:coverage
// The same numbers are enforced by tests/scenarios.test.mjs: a skill cannot declare a result line
// that no scenario exercises.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { extractContract } from "./contracts.mjs";
import { matchesReturn } from "./scenario.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const skills = readdirSync(join(PKG, "skills/pipeline")).filter((n) => existsSync(join(PKG, "skills/pipeline", n, "SKILL.md"))).sort();
/** @returns {{name: string, total: number, missing: string[]}[]} one row per non-group pipeline skill */
export function coverage() {
  const rows = [];
  for (const name of skills) {
    const c = parse(extractContract(readFileSync(join(PKG, "skills/pipeline", name, "SKILL.md"), "utf8")).yaml);
    if (c.kind === "group") continue; // a group's results are its items' results
    const dir = join(PKG, "tests/scenarios", name);
    const results = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith(".yaml")).flatMap((f) => {
          const sc = parse(readFileSync(join(dir, f), "utf8"));
          return (sc.expect.results ?? [sc.expect.result]).flatMap((r) => [r, r.replace(/^would: /, "")]);
        })
      : [];
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
}
