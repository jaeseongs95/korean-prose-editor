#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJsonl, sha256, stableJson, validateSelectionWorkProduct, validateSourceUnitManifest, writeNewFile } from "./lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const cycleDir = resolveCycleDir(options["cycle-dir"]);
const run = Number(options.run);
if (![1, 2, 3].includes(run)) throw new Error("run must be 1, 2, or 3");
const diagnosticDir = path.join(cycleDir, "diagnostic");
const suiteDir = resolveSuiteDir(diagnosticDir, options["suite-dir"]);
const runsRoot = resolveRunsRoot(suiteDir, options["runs-dir"]);
const runDir = path.join(runsRoot, `run-${run}`);
const inputText = await readFile(path.join(suiteDir, "input.jsonl"), "utf8");
const input = parseJsonl(inputText);
const manifests = parseJsonl(await readFile(path.join(suiteDir, "source-unit-manifest.jsonl"), "utf8"));
const selections = parseJsonl(await readFile(path.join(runDir, "selection-work-product.jsonl"), "utf8"));
if (input.length === 0 || manifests.length !== input.length || selections.length !== input.length) throw new Error("SELECTION_RECORD_COUNT_MISMATCH");

for (let index = 0; index < input.length; index += 1) {
  validateSourceUnitManifest(manifests[index], input[index].sourceText);
  validateSelectionWorkProduct(selections[index], manifests[index], input[index].sourceText);
}
const actors = new Set(selections.map((record) => record.actorId));
if (actors.size !== 1) throw new Error("SELECTION_ACTOR_CHANGED_WITHIN_RUN");
const meta = {
  schemaVersion: "2.0.0",
  run,
  role: "selection",
  actorId: [...actors][0],
  caseCount: selections.length,
  inputSha256: sha256(inputText),
  workProductSha256: sha256(stableJson(selections)),
  status: "complete",
};
await writeNewFile(path.join(runDir, "selection-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify(meta, null, 2));

function resolveCycleDir(value) {
  if (!value) throw new Error("--cycle-dir is required");
  const cyclesRoot = path.resolve(root, "evals", "cycles");
  const resolved = path.resolve(root, value);
  if (resolved === cyclesRoot || !resolved.startsWith(`${cyclesRoot}${path.sep}`)) throw new Error("cycle directory must be a child of evals/cycles");
  return resolved;
}

function resolveRunsRoot(diagnosticDir, value) {
  const resolved = path.resolve(diagnosticDir, value ?? "runs");
  if (resolved === diagnosticDir || !resolved.startsWith(`${diagnosticDir}${path.sep}`)) throw new Error("runs directory must be below the diagnostic directory");
  return resolved;
}

function resolveSuiteDir(diagnosticDir, value) {
  if (!value) return diagnosticDir;
  const resolved = path.resolve(diagnosticDir, value);
  if (resolved === diagnosticDir || !resolved.startsWith(`${diagnosticDir}${path.sep}`)) throw new Error("suite directory must be below the diagnostic directory");
  return resolved;
}

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--") || !arguments_[index + 1] || arguments_[index + 1].startsWith("--")) throw new Error(`invalid argument: ${argument}`);
    parsed[argument.slice(2)] = arguments_[index + 1];
    index += 1;
  }
  return parsed;
}
