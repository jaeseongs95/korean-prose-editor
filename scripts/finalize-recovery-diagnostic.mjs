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
  validateRunMetadata,
  writeNewFile,
} from "./lib/evaluation-cycle.mjs";
import { classifyRecovery } from "./lib/recovery-diagnostic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recoveryRoot = path.join(root, "evals", "cycles", "0.1.0-rc2", "recovery", "corpus-validity-v1");
const runRoot = path.join(recoveryRoot, "runs", "run-1");
const [contractText, freezeText, inputText, keyText, manifestText, rubricText, selectionText, editingText, verificationText, selectionMetaText, editingMetaText] = await Promise.all([
  readFile(path.join(recoveryRoot, "contract.json"), "utf8"),
  readFile(path.join(recoveryRoot, "FREEZE.json"), "utf8"),
  readFile(path.join(recoveryRoot, "input.jsonl"), "utf8"),
  readFile(path.join(recoveryRoot, "key.json"), "utf8"),
  readFile(path.join(recoveryRoot, "source-unit-manifest.jsonl"), "utf8"),
  readFile(path.join(root, "skills", "korean-prose-editor", "references", "verification-rubric.md"), "utf8"),
  readFile(path.join(runRoot, "selection-work-product.jsonl"), "utf8"),
  readFile(path.join(runRoot, "editing-work-product.jsonl"), "utf8"),
  readFile(path.join(runRoot, "verification-work-product.jsonl"), "utf8"),
  readFile(path.join(runRoot, "selection-meta.json"), "utf8"),
  readFile(path.join(runRoot, "editing-meta.json"), "utf8"),
]);
const contract = JSON.parse(contractText);
const freeze = JSON.parse(freezeText);
const input = parseJsonl(inputText);
const key = JSON.parse(keyText);
const manifests = parseJsonl(manifestText);
const products = {
  selection: parseJsonl(selectionText),
  editing: parseJsonl(editingText),
  verification: parseJsonl(verificationText),
};

for (const [relative, digest] of Object.entries(freeze.bindings)) {
  if (sha256(await readFile(path.join(root, relative))) !== digest) throw new Error(`RECOVERY_FREEZE_BINDING_CHANGED:${relative}`);
}
if (freeze.recoveryId !== contract.recoveryId || freeze.candidateCommit !== contract.candidateCommit || freeze.executionBudget !== 1) throw new Error("RECOVERY_FREEZE_IDENTITY_MISMATCH");
if ([manifests, products.selection, products.editing, products.verification].some((records) => records.length !== input.length)) throw new Error("RECOVERY_WORK_PRODUCT_COUNT_MISMATCH");

const verificationActors = new Set(products.verification.map((record) => record.actorId));
if (verificationActors.size !== 1) throw new Error("RECOVERY_VERIFICATION_ACTOR_CHANGED");
const verificationMeta = {
  schemaVersion: "2.0.0",
  run: 1,
  role: "verification",
  actorId: [...verificationActors][0],
  caseCount: products.verification.length,
  inputSha256: sha256(inputText),
  workProductSha256: sha256(stableJson(products.verification)),
  status: "complete",
};
const metas = {
  selection: JSON.parse(selectionMetaText),
  editing: JSON.parse(editingMetaText),
  verification: verificationMeta,
};
validateRunMetadata({ run: 1, inputSha256: sha256(inputText), products, metas });
const actorIds = [metas.selection.actorId, metas.editing.actorId, metas.verification.actorId];
if (new Set(actorIds).size !== 3) throw new Error("RECOVERY_ROLE_ACTOR_REUSE");

const rubricDigest = sha256(rubricText);
const finals = input.map((item, index) => evaluateStructuredCase({
  input: item,
  expectedDecision: key[index].expectedDecision,
  manifest: manifests[index],
  selection: products.selection[index],
  editing: products.editing[index],
  verification: products.verification[index],
  rubricDigest,
}));
const counts = {
  editSuccess: 0,
  editDenominator: 0,
  restraint: 0,
  restraintDenominator: 0,
  majorMeaningChanges: 0,
  protectedFailures: 0,
};
for (let index = 0; index < finals.length; index += 1) {
  const item = finals[index];
  const expected = key[index].expectedDecision;
  if (expected === "edit") {
    counts.editDenominator += 1;
    if (item.finalAction === "edit" && item.verification.pairPreference === "candidate") counts.editSuccess += 1;
  } else {
    counts.restraintDenominator += 1;
    const expectedAction = expected === "infeasible" ? "defer" : "retain";
    const selectedActions = products.selection[index].decisions.map((decision) => decision.action);
    if (item.finalText === input[index].sourceText && selectedActions.every((action) => action === expectedAction)) counts.restraint += 1;
  }
  if (item.finalText !== input[index].sourceText && item.verification.majorMeaningChange) counts.majorMeaningChanges += 1;
  if (!protectedEqual(input[index].sourceText, item.finalText, input[index].protectedStrings)) counts.protectedFailures += 1;
}

const feasibleUpperBound = key.filter((item) => item.expectedDecision === "edit").length;
const classification = classifyRecovery({ feasibleUpperBound, counts, thresholds: contract.thresholds });
const pass = classification.pass;
const result = {
  schemaVersion: "1.0.0",
  recoveryId: contract.recoveryId,
  status: classification.status,
  releaseDecision: "not-evaluated",
  comparableToPriorAttempts: false,
  executionCount: 1,
  candidateCommit: contract.candidateCommit,
  frameDigest: freeze.frameDigest,
  actorIds,
  thresholds: contract.thresholds,
  feasibleUpperBound,
  counts,
  cases: finals.map((item, index) => ({
    id: item.id,
    expectedDecision: key[index].expectedDecision,
    selectedAction: products.selection[index].decisions.map((decision) => decision.action),
    finalAction: item.finalAction,
    pairPreference: item.verification.pairPreference,
    majorMeaningChange: item.verification.majorMeaningChange,
    protectedStrings: item.verification.protectedStrings,
    pass: key[index].expectedDecision === "edit"
      ? item.finalAction === "edit" && item.verification.pairPreference === "candidate" && !item.verification.majorMeaningChange && item.verification.protectedStrings === "pass"
      : item.finalText === input[index].sourceText && products.selection[index].decisions.every((decision) => decision.action === (key[index].expectedDecision === "infeasible" ? "defer" : "retain")),
  })),
  nextStep: pass ? "run-fixed-diagnostic" : "stop-and-diagnose",
};

await writeNewFile(path.join(runRoot, "verification-meta.json"), `${JSON.stringify(verificationMeta, null, 2)}\n`);
await writeNewFile(path.join(recoveryRoot, "final-results.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!pass) process.exitCode = 1;

function protectedEqual(source, target, values) {
  return values.every((value) => occurrences(source, value) === occurrences(target, value));
}

function occurrences(text, value) {
  let count = 0;
  let offset = 0;
  while (value && (offset = text.indexOf(value, offset)) !== -1) {
    count += 1;
    offset += value.length;
  }
  return count;
}
