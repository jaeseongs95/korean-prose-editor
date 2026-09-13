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
const contrastDirectory = path.join(cycleDirectory, "diagnostic", "selection-taxonomy-contrast");
const [inputText, manifestText, keyText, specText, policyText] = await Promise.all([
  readFile(path.join(contrastDirectory, "input.jsonl"), "utf8"),
  readFile(path.join(contrastDirectory, "source-unit-manifest.jsonl"), "utf8"),
  readFile(path.join(contrastDirectory, "key.json"), "utf8"),
  readFile(path.join(contrastDirectory, "spec.json"), "utf8"),
  readFile(path.join(root, "skills", "korean-prose-editor", "references", "selection-policy.md"), "utf8"),
]);
const input = parseJsonl(inputText);
const manifests = parseJsonl(manifestText);
const key = JSON.parse(keyText);
const spec = JSON.parse(specText);
if (input.length !== spec.caseCount || manifests.length !== input.length || key.length !== input.length) {
  throw new Error("SELECTION_CONTRAST_RECORD_COUNT_MISMATCH");
}
if (spec.runCount !== 3 || spec.passCondition?.actionMatchPerRun !== `${input.length}/${input.length}`) {
  throw new Error("SELECTION_CONTRAST_SPEC_INVALID");
}
if (JSON.stringify(input.map((item) => item.id)) !== JSON.stringify(key.map((item) => item.id))) {
  throw new Error("SELECTION_CONTRAST_KEY_ORDER_MISMATCH");
}
for (let index = 0; index < input.length; index += 1) {
  validateSourceUnitManifest(manifests[index], input[index].sourceText);
}

const actors = new Set();
const runs = [];
for (let run = 1; run <= spec.runCount; run += 1) {
  const runDirectory = path.join(contrastDirectory, "runs", `run-${run}`);
  const selections = parseJsonl(await readFile(path.join(runDirectory, "selection-work-product.jsonl"), "utf8"));
  const meta = JSON.parse(await readFile(path.join(runDirectory, "selection-meta.json"), "utf8"));
  if (selections.length !== input.length) throw new Error(`SELECTION_CONTRAST_RUN_${run}_COUNT_MISMATCH`);
  if (meta.schemaVersion !== "2.0.0" || meta.run !== run || meta.role !== "selection" || meta.caseCount !== input.length || meta.status !== "complete") {
    throw new Error(`SELECTION_CONTRAST_RUN_${run}_META_INVALID`);
  }
  if (meta.inputSha256 !== sha256(inputText) || meta.workProductSha256 !== sha256(stableJson(selections))) {
    throw new Error(`SELECTION_CONTRAST_RUN_${run}_META_DIGEST_MISMATCH`);
  }
  if (new Set(selections.map((record) => record.actorId)).size !== 1 || selections[0]?.actorId !== meta.actorId) {
    throw new Error(`SELECTION_CONTRAST_RUN_${run}_ACTOR_MISMATCH`);
  }
  if (actors.has(meta.actorId)) throw new Error("SELECTION_CONTRAST_ACTOR_REUSE");
  actors.add(meta.actorId);
  const actions = selections.map((record, index) => {
    validateSelectionWorkProduct(record, manifests[index], input[index].sourceText);
    if (record.decisions.length !== 1) throw new Error(`SELECTION_CONTRAST_RUN_${run}_UNIT_COUNT_MISMATCH`);
    return record.decisions[0].action;
  });
  const actionMatchCount = actions.filter((action, index) => action === key[index].expectedDecision).length;
  runs.push({
    run,
    actorId: meta.actorId,
    workProductSha256: meta.workProductSha256,
    actions,
    actionMatch: `${actionMatchCount}/${input.length}`,
    pass: actionMatchCount === input.length,
  });
}

const result = {
  schemaVersion: "1.0.0",
  status: runs.every((run) => run.pass) ? "pass" : "fail",
  purpose: spec.purpose,
  inputSha256: sha256(inputText),
  policySha256: sha256(policyText),
  expectedActions: key.map((item) => item.expectedDecision),
  actorsDistinct: actors.size === spec.runCount,
  runs,
  conclusion: runs.every((run) => run.pass)
    ? "All three blinded selection runs separated the five local translationese defects from their five natural controls."
    : "At least one blinded selection run did not separate every defect from its paired natural control.",
};
await writeNewFile(path.join(contrastDirectory, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "pass") process.exitCode = 1;

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
