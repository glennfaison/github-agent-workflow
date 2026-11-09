// Makes a world file a run can write to from a scenario (or another world file).
//   node tests/sim/seed.mjs <scenario.yaml> <world.yaml|world.json>
// The simulator reads a scenario file as it is, but never writes to one, so a run starts from a copy.

import { writeFileSync } from "node:fs";
import { stringify } from "yaml";
import { loadWorld } from "./world.mjs";

export function seed(from, to) {
  const { world, notShown } = loadWorld(from);
  writeFileSync(to, /\.ya?ml$/.test(to) ? stringify(world) : JSON.stringify(world, null, 2) + "\n");
  return { world, notShown };
}

if (process.argv[1]?.endsWith("seed.mjs")) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) { console.error("usage: node tests/sim/seed.mjs <scenario|world> <out.yaml|out.json>"); process.exit(2); }
  const { notShown } = seed(from, to);
  if (notShown.length) console.error(`note: ${notShown.length} world field(s) stand for facts a model would read from prose, and no gh call shows them: ${notShown.join(", ")}`);
}
