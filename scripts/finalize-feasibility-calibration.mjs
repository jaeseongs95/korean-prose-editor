#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { finalizeFeasibilityCalibration } from "./lib/feasibility-calibration.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
if (!options["cycle-dir"]) throw new Error("--cycle-dir is required");
const result = await finalizeFeasibilityCalibration({ repositoryRoot, cycleDirectory: options["cycle-dir"] });
console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed-feasibility") process.exitCode = 1;

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
