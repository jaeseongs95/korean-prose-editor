#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { recordFeasibilityVerification } from "./lib/feasibility-calibration.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
if (!options["cycle-dir"]) throw new Error("--cycle-dir is required");
const run = Number(options.run);
if (![1, 2, 3].includes(run)) throw new Error("--run must be 1, 2, or 3");
const meta = await recordFeasibilityVerification({
  repositoryRoot,
  cycleDirectory: options["cycle-dir"],
  run,
  draftFile: options.draft,
});
console.log(JSON.stringify(meta, null, 2));

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--") || !arguments_[index + 1] || arguments_[index + 1].startsWith("--")) throw new Error(`invalid argument: ${argument}`);
    parsed[argument.slice(2)] = arguments_[index + 1];
    index += 1;
  }
  return parsed;
}
