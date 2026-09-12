#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = Number(process.argv.slice(2).find((argument) => argument !== "--"));
if (![1, 2, 3].includes(run)) throw new Error("run must be 1, 2, or 3");
const runDir = path.join(root, "evals", "runs", `run-${run}`);

const input = parseJsonl(await readFile(path.join(root, "evals", "runs", "input.jsonl"), "utf8"));
const key = JSON.parse(await readFile(path.join(root, "evals", "runs", "key.json"), "utf8"));
const selection = parseJsonl(await readFile(path.join(runDir, "selection.jsonl"), "utf8"));
const candidate = parseJsonl(await readFile(path.join(runDir, "candidate.jsonl"), "utf8"));
const verification = parseJsonl(await readFile(path.join(runDir, "verification.jsonl"), "utf8"));
const metas = await Promise.all(["selection", "editing", "verification"].map((role) => readJson(path.join(runDir, `${role}-meta.json`))));
const verificationInputMeta = await readJson(path.join(runDir, "verification-input-meta.json"));
const manifest = await readJson(path.join(root, "evals", "runs", "manifest.json"));
const protocol = await readFile(path.join(root, "evals", "EVALUATION_PROTOCOL.md"));
const rubric = await readFile(path.join(root, "skills", "korean-prose-editor", "references", "verification-rubric.md"));

const errors = [];
for (const [name, records] of [["selection", selection], ["candidate", candidate], ["verification", verification]]) {
  if (records.length !== input.length) errors.push(`${name.toUpperCase()}_COUNT_MISMATCH`);
  input.forEach((item, index) => {
    if (records[index]?.id !== item.id) errors.push(`${name.toUpperCase()}_ORDER_MISMATCH:${item.id}`);
  });
}
const actorIds = metas.map((meta) => meta.actorId);
if (new Set(actorIds).size !== 3) errors.push("ROLE_ACTOR_REUSE");
if (metas.some((meta) => meta.caseCount !== 130)) errors.push("ROLE_CASE_COUNT_MISMATCH");
const verificationInputSha256 = metas[2]?.verificationInputSha256 ?? metas[2]?.inputSha256;
if (metas[0]?.inputSha256 !== manifest.inputSha256 || metas[1]?.inputSha256 !== manifest.inputSha256 || verificationInputSha256 !== verificationInputMeta.sha256) errors.push("ROLE_INPUT_DIGEST_MISMATCH");
if (metas[2]?.rubricSha256 !== sha256(rubric)) errors.push("VERIFICATION_RUBRIC_DIGEST_MISMATCH");
if (sha256(protocol) !== manifest.frozenBindings.protocolSha256) errors.push("RUBRIC_DIGEST_CHANGED");

const keyById = new Map(key.map((item) => [item.id, item]));
const finals = input.map((item, index) => {
  const selected = selection[index];
  const edited = candidate[index];
  const verified = verification[index];
  if (selected?.actorId !== actorIds[0] || edited?.actorId !== actorIds[1] || verified?.actorId !== actorIds[2]) errors.push(`ACTOR_BINDING_MISMATCH:${item.id}`);
  if (edited?.selectionAction !== selected?.action) errors.push(`SELECTION_BINDING_MISMATCH:${item.id}`);
  if ((selected?.action === "retain" || selected?.action === "defer") && edited?.candidateText !== item.sourceText) errors.push(`NON_EDIT_CHANGED:${item.id}`);
  const deterministicProtectedPass = protectedEqual(item.sourceText, edited?.candidateText ?? "", item.protectedStrings ?? []);
  const safe = verified?.finalDecision === "accept" && verified.meaningPreservation === "pass" && verified.majorMeaningChange === false && verified.registerCompliance === "pass" && verified.protectedStrings === "pass" && verified.terminologyJudgment !== "fail" && deterministicProtectedPass;
  const finalText = safe ? edited.candidateText : item.sourceText;
  return {
    id: item.id,
    suite: item.suite,
    expectedDecision: keyById.get(item.id)?.expectedDecision,
    selectionAction: selected?.action,
    sourceText: item.sourceText,
    candidateText: edited?.candidateText,
    finalText,
    finalAction: safe && finalText !== item.sourceText ? "edit" : verified?.finalDecision === "uncertain" ? "defer" : "retain",
    restored: !safe && edited?.candidateText !== item.sourceText,
    verification: verified,
  };
});

const legacy = finals.filter((item) => item.suite === "legacy-100");
const holdout = finals.filter((item) => item.suite === "holdout-30");
const metrics = {
  schemaVersion: "1.0.0",
  run,
  candidateCommit: manifest.candidateCommit,
  actorIds,
  counts: {
    cases: finals.length,
    selection: countBy(finals, (item) => item.selectionAction),
    final: countBy(finals, (item) => item.finalAction),
    restored: finals.filter((item) => item.restored).length,
    uncertain: verification.filter((item) => item.finalDecision === "uncertain" || item.meaningPreservation === "uncertain" || item.registerCompliance === "uncertain" || item.terminologyJudgment === "uncertain").length,
  },
  candidate: {
    protectedExactRate: rate(finals.filter((item) => protectedEqual(item.sourceText, item.candidateText, input.find((source) => source.id === item.id)?.protectedStrings ?? [])).length, finals.length),
    majorMeaningFailures: verification.filter((item) => item.majorMeaningChange === true).length,
  },
  release: {
    protectedExactRate: rate(finals.filter((item) => protectedEqual(item.sourceText, item.finalText, input.find((source) => source.id === item.id)?.protectedStrings ?? [])).length, finals.length),
    legacyMeaningPassRate: rate(legacy.filter((item) => item.finalText === item.sourceText || item.verification.meaningPreservation === "pass").length, legacy.length),
    legacyImprovementRate: improvementRate(legacy),
    legacyRegressionRate: regressionRate(legacy),
    legacyRestraintSuccessRate: restraintRate(legacy),
    holdoutMajorMeaningFailures: holdout.filter((item) => item.finalText !== item.sourceText && item.verification.majorMeaningChange).length,
    holdoutProtectedFailures: holdout.filter((item) => !protectedEqual(item.sourceText, item.finalText, input.find((source) => source.id === item.id)?.protectedStrings ?? [])).length,
    holdoutImprovementRate: improvementRate(holdout),
    holdoutRestraintSuccessRate: restraintRate(holdout),
    roleReuse: new Set(actorIds).size === 3 ? 0 : 1,
    missingEvidence: errors.length,
    rubricChanges: sha256(protocol) === manifest.frozenBindings.protocolSha256 ? 0 : 1,
  },
  errors,
};

const thresholds = manifest.thresholds;
metrics.gate = {
  pass: metrics.release.protectedExactRate >= thresholds.protectedExactRate &&
    metrics.release.legacyMeaningPassRate >= thresholds.legacyMeaningPassRate &&
    metrics.release.legacyImprovementRate >= thresholds.legacyImprovementRate &&
    metrics.release.legacyRegressionRate <= thresholds.legacyRegressionRateMax &&
    metrics.release.legacyRestraintSuccessRate >= thresholds.legacyRestraintSuccessRate &&
    metrics.release.holdoutMajorMeaningFailures <= thresholds.holdoutMajorMeaningFailuresMax &&
    metrics.release.holdoutProtectedFailures <= thresholds.holdoutProtectedFailuresMax &&
    metrics.release.holdoutImprovementRate >= thresholds.holdoutImprovementRate &&
    metrics.release.holdoutRestraintSuccessRate >= thresholds.holdoutRestraintSuccessRate &&
    metrics.release.roleReuse <= thresholds.roleReuseMax &&
    metrics.release.missingEvidence <= thresholds.missingEvidenceMax &&
    metrics.release.rubricChanges <= thresholds.rubricChangesMax,
};

await writeFile(path.join(runDir, "final.jsonl"), `${finals.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
await writeFile(path.join(runDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
console.log(JSON.stringify(metrics, null, 2));

function improvementRate(records) {
  const expected = records.filter((item) => item.expectedDecision === "edit");
  return rate(expected.filter((item) => item.finalAction === "edit" && item.verification.pairPreference === "candidate").length, expected.length);
}

function restraintRate(records) {
  const expected = records.filter((item) => item.expectedDecision === "retain" || item.expectedDecision === "defer");
  return rate(expected.filter((item) => item.finalText === item.sourceText).length, expected.length);
}

function regressionRate(records) {
  return rate(records.filter((item) => item.finalText !== item.sourceText && (item.verification.pairPreference === "original" || item.verification.pairPreference === "neither" || item.verification.meaningPreservation !== "pass" || item.verification.registerCompliance !== "pass" || item.verification.protectedStrings !== "pass" || item.verification.terminologyJudgment === "fail")).length, records.length);
}

function protectedEqual(source, target, values) {
  return values.every((value) => count(source, value) === count(target, value) && firstIndexOrder(source, values).join(",") === firstIndexOrder(target, values).join(","));
}

function firstIndexOrder(text, values) {
  return values.filter((value) => text.includes(value)).map((value) => [value, text.indexOf(value)]).sort((left, right) => left[1] - right[1]).map(([value]) => value);
}

function count(text, value) {
  if (!value) return 0;
  let total = 0;
  let offset = 0;
  while ((offset = text.indexOf(value, offset)) !== -1) { total += 1; offset += value.length; }
  return total;
}

function countBy(records, getValue) {
  return Object.fromEntries([...new Set(records.map(getValue))].sort().map((value) => [value, records.filter((record) => getValue(record) === value).length]));
}

function rate(numerator, denominator) {
  return denominator === 0 ? 100 : Number(((numerator / denominator) * 100).toFixed(2));
}

function parseJsonl(text) {
  return text.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
