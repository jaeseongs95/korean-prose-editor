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
const runsRoot = resolveRunsRoot(diagnosticDir, options["runs-dir"]);
const runDir = path.join(runsRoot, `run-${run}`);
const inputText = await readFile(path.join(diagnosticDir, "input.jsonl"), "utf8");
const input = parseJsonl(inputText);
const manifests = parseJsonl(await readFile(path.join(diagnosticDir, "source-unit-manifest.jsonl"), "utf8"));
const selections = parseJsonl(await readFile(path.join(runDir, "selection-work-product.jsonl"), "utf8"));
const meta = JSON.parse(await readFile(path.join(runDir, "selection-meta.json"), "utf8"));
const inventory = JSON.parse(await readFile(path.join(diagnosticDir, "inventory.json"), "utf8"));
if (input.length !== 39 || manifests.length !== input.length || selections.length !== input.length) throw new Error("DIAGNOSTIC_RECORD_COUNT_MISMATCH");
if (meta.schemaVersion !== "2.0.0" || meta.run !== run || meta.role !== "selection" || meta.caseCount !== input.length || meta.status !== "complete") throw new Error("SELECTION_META_INVALID");
if (meta.inputSha256 !== sha256(inputText) || meta.workProductSha256 !== sha256(stableJson(selections))) throw new Error("SELECTION_META_DIGEST_MISMATCH");
if (new Set(selections.map((record) => record.actorId)).size !== 1 || selections[0]?.actorId !== meta.actorId) throw new Error("SELECTION_META_ACTOR_MISMATCH");

const selectedById = new Map();
for (let index = 0; index < input.length; index += 1) {
  validateSourceUnitManifest(manifests[index], input[index].sourceText);
  validateSelectionWorkProduct(selections[index], manifests[index], input[index].sourceText);
  selectedById.set(input[index].id, selections[index].decisions.some((decision) => decision.action === "edit"));
}
const editRecallCount = inventory.editCases.filter((item) => selectedById.get(item.caseId) === true).length;
const restraintCount = inventory.controlCases.filter((item) => selectedById.get(item.caseId) === false).length;
const regressionResults = inventory.regressionCases.map((item) => ({ caseId: item.caseId, selectedEdit: selectedById.get(item.caseId) === true }));
const allDecisions = selections.flatMap((record) => record.decisions);
const metrics = {
  schemaVersion: "1.0.0",
  cycleId: path.basename(cycleDir),
  run,
  actorId: meta.actorId,
  counts: {
    cases: input.length,
    units: allDecisions.length,
    edit: allDecisions.filter((decision) => decision.action === "edit").length,
    retain: allDecisions.filter((decision) => decision.action === "retain").length,
    defer: allDecisions.filter((decision) => decision.action === "defer").length,
  },
  diagnostic: { editRecallCount, editRecallDenominator: 18, restraintCount, restraintDenominator: 20, regressionResults },
  gate: {
    editRecallPass: editRecallCount >= inventory.thresholds.editRecallMinimum,
    restraintPass: restraintCount >= inventory.thresholds.restraintMinimum,
    regressionPass: regressionResults.every((item) => item.selectedEdit),
  },
};
metrics.gate.pass = metrics.gate.editRecallPass && metrics.gate.restraintPass && metrics.gate.regressionPass;
await writeNewFile(path.join(runDir, "selection-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics, null, 2));

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
