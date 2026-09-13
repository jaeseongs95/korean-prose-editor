#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  parseJsonl,
  sha256,
  stableJson,
  validateSelectionWorkProduct,
  validateSourceUnitManifest,
  writeNewFile,
} from "./lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const cycleDirectory = resolveCycleDirectory(options["cycle-dir"]);
const attempt = Number(options.attempt);
if (!Number.isInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive integer");
const candidatesDirectory = path.join(cycleDirectory, "diagnostic", "semantic-regression", "new-candidates");
const [inputText, manifestText, keyText] = await Promise.all([
  readFile(path.join(candidatesDirectory, "input.jsonl"), "utf8"),
  readFile(path.join(candidatesDirectory, "source-unit-manifest.jsonl"), "utf8"),
  readFile(path.join(candidatesDirectory, "key.json"), "utf8"),
]);
const input = parseJsonl(inputText);
const manifests = parseJsonl(manifestText);
const key = JSON.parse(keyText);
if (input.length !== 11 || manifests.length !== input.length || key.length !== input.length) {
  throw new Error("NEW_CANDIDATE_RECORD_COUNT_MISMATCH");
}
if (JSON.stringify(input.map((item) => item.id)) !== JSON.stringify(key.map((item) => item.id))) {
  throw new Error("NEW_CANDIDATE_KEY_ORDER_MISMATCH");
}
for (let index = 0; index < input.length; index += 1) {
  validateSourceUnitManifest(manifests[index], input[index].sourceText);
}

const actors = new Set();
const runs = [];
for (let run = 1; run <= 3; run += 1) {
  const runDirectory = path.join(candidatesDirectory, `attempt-${attempt}`, "runs", `run-${run}`);
  const selections = parseJsonl(await readFile(path.join(runDirectory, "selection-work-product.jsonl"), "utf8"));
  const meta = JSON.parse(await readFile(path.join(runDirectory, "selection-meta.json"), "utf8"));
  if (selections.length !== input.length) throw new Error(`NEW_CANDIDATE_RUN_${run}_COUNT_MISMATCH`);
  if (meta.schemaVersion !== "2.0.0" || meta.run !== run || meta.role !== "selection" || meta.caseCount !== input.length || meta.status !== "complete") {
    throw new Error(`NEW_CANDIDATE_RUN_${run}_META_INVALID`);
  }
  if (meta.inputSha256 !== sha256(inputText) || meta.workProductSha256 !== sha256(stableJson(selections))) {
    throw new Error(`NEW_CANDIDATE_RUN_${run}_META_DIGEST_MISMATCH`);
  }
  if (new Set(selections.map((record) => record.actorId)).size !== 1 || selections[0]?.actorId !== meta.actorId) {
    throw new Error(`NEW_CANDIDATE_RUN_${run}_ACTOR_MISMATCH`);
  }
  if (actors.has(meta.actorId)) throw new Error("NEW_CANDIDATE_ACTOR_REUSE");
  actors.add(meta.actorId);
  let improvementCount = 0;
  for (let index = 0; index < input.length; index += 1) {
    validateSelectionWorkProduct(selections[index], manifests[index], input[index].sourceText);
    const selectedEdit = selections[index].decisions.some((decision) => decision.action === "edit");
    if ((selectedEdit ? "edit" : selections[index].decisions[0]?.action) === key[index].expectedDecision) improvementCount += 1;
  }
  runs.push({
    run,
    selectionActorId: meta.actorId,
    selectedEditCases: `${improvementCount}/${input.length}`,
    selectionContract: "pass",
    editingStarted: false,
    pass: improvementCount >= 9,
  });
}

const pass = runs.every((run) => run.pass);
const result = {
  schemaVersion: "1.0.0",
  attempt,
  status: pass ? "passed-selection" : "failed-selection",
  requiredImprovement: "9/11",
  actorsDistinct: actors.size === 3,
  runs,
  nextStep: pass
    ? "Run independent editing and verification before freezing a release candidate."
    : "Preserve this attempt and diagnose the remaining selection variance before editing.",
};
await writeNewFile(path.join(candidatesDirectory, `attempt-${attempt}-results.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!pass) process.exitCode = 1;

function resolveCycleDirectory(value) {
  if (!value) throw new Error("--cycle-dir is required");
  const cyclesRoot = path.resolve(root, "evals", "cycles");
  const resolved = path.resolve(root, value);
  if (resolved === cyclesRoot || !resolved.startsWith(`${cyclesRoot}${path.sep}`)) {
    throw new Error("cycle directory must be a child of evals/cycles");
  }
  return resolved;
}

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--") || !arguments_[index + 1] || arguments_[index + 1].startsWith("--")) {
      throw new Error(`invalid argument: ${argument}`);
    }
    parsed[argument.slice(2)] = arguments_[index + 1];
    index += 1;
  }
  return parsed;
}
