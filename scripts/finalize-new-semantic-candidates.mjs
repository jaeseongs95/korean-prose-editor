#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  evaluateStructuredCase,
  parseJsonl,
  sha256,
  stableJson,
  writeNewFile,
} from "./lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const cycleDirectory = resolveCycleDirectory(options["cycle-dir"]);
const attempt = Number(options.attempt);
if (!Number.isInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive integer");
const candidatesDirectory = path.join(cycleDirectory, "diagnostic", "semantic-regression", "new-candidates");
const [inputText, manifestText, keyText, rubricText] = await Promise.all([
  readFile(path.join(candidatesDirectory, "input.jsonl"), "utf8"),
  readFile(path.join(candidatesDirectory, "source-unit-manifest.jsonl"), "utf8"),
  readFile(path.join(candidatesDirectory, "key.json"), "utf8"),
  readFile(path.join(root, "skills", "korean-prose-editor", "references", "verification-rubric.md"), "utf8"),
]);
const input = parseJsonl(inputText);
const manifests = parseJsonl(manifestText);
const key = JSON.parse(keyText);
const rubricDigest = sha256(rubricText);
if (input.length !== 11 || manifests.length !== input.length || key.length !== input.length) {
  throw new Error("NEW_CANDIDATE_RECORD_COUNT_MISMATCH");
}
if (JSON.stringify(input.map((item) => item.id)) !== JSON.stringify(key.map((item) => item.id)) || key.some((item) => item.expectedDecision !== "edit")) {
  throw new Error("NEW_CANDIDATE_KEY_MISMATCH");
}

const globalActors = new Set();
const runs = [];
const verificationMetas = [];
for (let run = 1; run <= 3; run += 1) {
  const runDirectory = path.join(candidatesDirectory, `attempt-${attempt}`, "runs", `run-${run}`);
  const [selectionText, editingText, verificationText, selectionMetaText, editingMetaText] = await Promise.all([
    readFile(path.join(runDirectory, "selection-work-product.jsonl"), "utf8"),
    readFile(path.join(runDirectory, "editing-work-product.jsonl"), "utf8"),
    readFile(path.join(runDirectory, "verification-work-product.jsonl"), "utf8"),
    readFile(path.join(runDirectory, "selection-meta.json"), "utf8"),
    readFile(path.join(runDirectory, "editing-meta.json"), "utf8"),
  ]);
  const selections = parseJsonl(selectionText);
  const editings = parseJsonl(editingText);
  const verifications = parseJsonl(verificationText);
  const selectionMeta = JSON.parse(selectionMetaText);
  const editingMeta = JSON.parse(editingMetaText);
  if ([selections, editings, verifications].some((records) => records.length !== input.length)) {
    throw new Error(`NEW_CANDIDATE_RUN_${run}_COUNT_MISMATCH`);
  }
  validateMeta(selectionMeta, { run, role: "selection", inputText, records: selections });
  validateMeta(editingMeta, { run, role: "editing", inputText, records: editings });
  const roleActors = [selections, editings, verifications].map((records) => {
    const actors = new Set(records.map((record) => record.actorId));
    if (actors.size !== 1) throw new Error(`NEW_CANDIDATE_RUN_${run}_ROLE_ACTOR_CHANGED`);
    return [...actors][0];
  });
  if (roleActors[0] !== selectionMeta.actorId || roleActors[1] !== editingMeta.actorId || new Set(roleActors).size !== 3) {
    throw new Error(`NEW_CANDIDATE_RUN_${run}_ROLE_ACTOR_REUSE`);
  }
  for (const actor of roleActors) {
    if (globalActors.has(actor)) throw new Error("NEW_CANDIDATE_GLOBAL_ACTOR_REUSE");
    globalActors.add(actor);
  }

  const finals = input.map((item, index) => evaluateStructuredCase({
    input: item,
    expectedDecision: key[index].expectedDecision,
    manifest: manifests[index],
    selection: selections[index],
    editing: editings[index],
    verification: verifications[index],
    rubricDigest,
  }));
  const improvementCount = finals.filter((item) => item.finalAction === "edit" && item.verification.pairPreference === "candidate").length;
  const majorMeaningChangeCount = finals.filter((item, index) =>
    item.finalText !== input[index].sourceText && item.verification.majorMeaningChange).length;
  const protectedFailureCount = finals.filter((item, index) => !protectedEqual(input[index].sourceText, item.finalText, input[index].protectedStrings ?? [])).length;
  const acceptedEditCount = finals.reduce((total, item) => total + item.editResults.filter((edit) => edit.decision === "accept").length, 0);
  const verificationMeta = {
    schemaVersion: "2.0.0",
    run,
    role: "verification",
    actorId: roleActors[2],
    caseCount: verifications.length,
    inputSha256: sha256(inputText),
    workProductSha256: sha256(stableJson(verifications)),
    status: "complete",
  };
  verificationMetas.push({ runDirectory, verificationMeta });
  runs.push({
    run,
    actorIds: { selection: roleActors[0], editing: roleActors[1], verification: roleActors[2] },
    improvedCases: `${improvementCount}/${input.length}`,
    acceptedEditCount,
    majorMeaningChangeCount,
    protectedFailureCount,
    pass: improvementCount >= 9 && majorMeaningChangeCount === 0 && protectedFailureCount === 0,
  });
}

const pass = runs.every((run) => run.pass);
const result = {
  schemaVersion: "1.0.0",
  attempt,
  status: pass ? "passed-final" : "failed-final",
  requiredImprovement: "9/11",
  globalActorsDistinct: globalActors.size === 9,
  runs,
  nextStep: pass
    ? "Run the full fixed diagnostic before freezing the candidate commit and creating the private holdout."
    : "Preserve this attempt and diagnose the failed editing or verification evidence.",
};
await Promise.all(verificationMetas.map(({ runDirectory, verificationMeta }) =>
  writeNewFile(path.join(runDirectory, "verification-meta.json"), `${JSON.stringify(verificationMeta, null, 2)}\n`)));
await writeNewFile(path.join(candidatesDirectory, `attempt-${attempt}-final-results.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!pass) process.exitCode = 1;

function validateMeta(meta, { run, role, inputText: sourceInput, records }) {
  if (meta.schemaVersion !== "2.0.0" || meta.run !== run || meta.role !== role || meta.caseCount !== records.length || meta.status !== "complete") {
    throw new Error(`NEW_CANDIDATE_RUN_${run}_${role.toUpperCase()}_META_INVALID`);
  }
  if (meta.inputSha256 !== sha256(sourceInput) || meta.workProductSha256 !== sha256(stableJson(records))) {
    throw new Error(`NEW_CANDIDATE_RUN_${run}_${role.toUpperCase()}_META_DIGEST_MISMATCH`);
  }
}

function protectedEqual(source, target, values) {
  return values.every((value) => countOccurrences(source, value) === countOccurrences(target, value));
}

function countOccurrences(text, value) {
  if (value.length === 0) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(value, index)) !== -1) {
    count += 1;
    index += value.length;
  }
  return count;
}

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
