// Finds a skill of this package by name, in any bucket, and parses its `## Contract`. Shared by the
// scenario checker (a group skill is checked against the contract of the item skill it dispatches) and
// the coverage report.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { extractContract } from "./contracts.mjs";

export const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(PKG, "skills");

/** Every skill directory in the package: `skills/<bucket>/<skill>`. */
export const skillDirs = () => readdirSync(SKILLS, { withFileTypes: true }).filter((b) => b.isDirectory()).flatMap((b) =>
  readdirSync(join(SKILLS, b.name), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SKILLS, b.name, d.name, "SKILL.md")))
    .map((d) => ({ name: d.name, dir: join(SKILLS, b.name, d.name) })));

/** The parsed contract of a skill, or null when it has none or is not a skill of this package. */
export function contractOf(name) {
  const found = skillDirs().find((s) => s.name === name);
  const block = found && extractContract(readFileSync(join(found.dir, "SKILL.md"), "utf8"));
  return block ? parse(block.yaml) : null;
}
