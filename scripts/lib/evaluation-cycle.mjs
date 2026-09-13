import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { finalizeEvaluationCase } from "../evaluation-finalizer.mjs";

export const WORK_PRODUCT_SCHEMA_VERSION = "1.0.0";
export const RUN_BUDGET = 3;
export const RELEASE_THRESHOLD_KEYS = Object.freeze([
  "protectedExactRate",
  "legacyMeaningPassRate",
  "legacyImprovementRate",
  "legacyRegressionRateMax",
  "legacyRestraintSuccessRate",
  "holdoutMajorMeaningFailuresMax",
  "holdoutProtectedFailuresMax",
  "holdoutImprovementRate",
  "holdoutRestraintSuccessRate",
  "roleReuseMax",
  "missingEvidenceMax",
  "rubricChangesMax",
]);

const DIGEST = /^[a-f0-9]{64}$/u;
const ACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

export function workProductDigest(value) {
  return sha256(stableJson(value));
}

export function parseJsonl(text) {
  return text.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

export function serializeJsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function validateSourceUnitManifest(value, source) {
  requireExactObject(value, "source-unit-manifest", ["schemaVersion", "sourceDigest", "sourceLength", "units"]);
  requireSchemaVersion(value);
  requireDigest(value.sourceDigest, "source-unit-manifest.sourceDigest");
  if (value.sourceDigest !== sha256(source)) throw new Error("SOURCE_MANIFEST_DIGEST_MISMATCH");
  if (value.sourceLength !== source.length) throw new Error("SOURCE_MANIFEST_LENGTH_MISMATCH");
  if (!Array.isArray(value.units)) throw new Error("SOURCE_MANIFEST_UNITS_INVALID");

  const ids = new Set();
  let nextStart = 0;
  for (const unit of value.units) {
    requireExactObject(unit, "source unit", ["unitId", "start", "end", "kind", "digest", "protectedSpanIds"]);
    if (typeof unit.unitId !== "string" || !/^unit-[0-9]{4,}$/u.test(unit.unitId) || ids.has(unit.unitId)) throw new Error("SOURCE_UNIT_ID_INVALID");
    if (!Number.isInteger(unit.start) || !Number.isInteger(unit.end) || unit.start < nextStart || unit.end <= unit.start || unit.end > source.length) throw new Error("SOURCE_UNIT_RANGE_INVALID");
    if (unit.kind !== "prose" && unit.kind !== "fenced-code") throw new Error("SOURCE_UNIT_KIND_INVALID");
    requireDigest(unit.digest, "source unit digest");
    if (unit.digest !== sha256(source.slice(unit.start, unit.end))) throw new Error("SOURCE_UNIT_DIGEST_MISMATCH");
    if (!Array.isArray(unit.protectedSpanIds) || new Set(unit.protectedSpanIds).size !== unit.protectedSpanIds.length || unit.protectedSpanIds.some((item) => typeof item !== "string" || !/^span-[0-9]{4,}$/u.test(item))) throw new Error("SOURCE_UNIT_PROTECTED_IDS_INVALID");
    ids.add(unit.unitId);
    nextStart = unit.end;
  }
  return value;
}

export function validateSelectionWorkProduct(value, manifest) {
  requireExactObject(value, "selection-work-product", ["schemaVersion", "actorId", "sourceDigest", "status", "decisions"]);
  requireSchemaVersion(value);
  requireActor(value.actorId, "selection actorId");
  requireDigest(value.sourceDigest, "selection sourceDigest");
  if (value.sourceDigest !== manifest.sourceDigest) throw new Error("SELECTION_SOURCE_DIGEST_MISMATCH");
  if (!["ready", "needs-input", "blocked"].includes(value.status)) throw new Error("SELECTION_STATUS_INVALID");
  if (!Array.isArray(value.decisions)) throw new Error("SELECTION_DECISIONS_INVALID");
  const units = new Map(manifest.units.map((unit) => [unit.unitId, unit]));
  const seen = new Set();
  for (const decision of value.decisions) {
    requireExactObject(decision, "selection decision", ["unitId", "action", "reasonCodes", "riskFlags", "additionalProtectedStrings"]);
    if (!units.has(decision.unitId) || seen.has(decision.unitId)) throw new Error("SELECTION_UNIT_BINDING_INVALID");
    if (!["edit", "retain", "defer"].includes(decision.action)) throw new Error("SELECTION_ACTION_INVALID");
    for (const field of ["reasonCodes", "riskFlags"]) {
      if (!Array.isArray(decision[field]) || new Set(decision[field]).size !== decision[field].length || decision[field].some((item) => typeof item !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(item))) throw new Error(`SELECTION_${field.toUpperCase()}_INVALID`);
    }
    if (!Array.isArray(decision.additionalProtectedStrings) || new Set(decision.additionalProtectedStrings).size !== decision.additionalProtectedStrings.length || decision.additionalProtectedStrings.some((item) => typeof item !== "string" || item.length === 0)) throw new Error("SELECTION_ADDITIONAL_PROTECTED_STRINGS_INVALID");
    if (units.get(decision.unitId).kind === "fenced-code" && decision.action === "edit") throw new Error("FENCED_CODE_SELECTED_FOR_EDIT");
    seen.add(decision.unitId);
  }
  if (seen.size !== units.size) throw new Error("SELECTION_DECISION_COVERAGE_MISMATCH");
  if (value.status !== "ready" && value.decisions.some((decision) => decision.action === "edit")) throw new Error("NON_READY_SELECTION_HAS_EDIT");
  return value;
}

export function validateEditingWorkProduct(value, { source, manifest, selection }) {
  requireExactObject(value, "editing-work-product", ["schemaVersion", "actorId", "sourceDigest", "selectionDigest", "edits", "candidateDigest"]);
  requireSchemaVersion(value);
  requireActor(value.actorId, "editing actorId");
  requireDigest(value.sourceDigest, "editing sourceDigest");
  requireDigest(value.selectionDigest, "editing selectionDigest");
  requireDigest(value.candidateDigest, "editing candidateDigest");
  if (value.sourceDigest !== manifest.sourceDigest) throw new Error("EDITING_SOURCE_DIGEST_MISMATCH");
  if (value.selectionDigest !== workProductDigest(selection)) throw new Error("EDITING_SELECTION_DIGEST_MISMATCH");
  if (!Array.isArray(value.edits)) throw new Error("EDITING_EDITS_INVALID");

  const units = new Map(manifest.units.map((unit) => [unit.unitId, unit]));
  const actions = new Map(selection.decisions.map((decision) => [decision.unitId, decision.action]));
  const ids = new Set();
  const sorted = [...value.edits].sort(compareEdits);
  for (const edit of sorted) {
    requireExactObject(edit, "edit", ["id", "unitId", "sourceDigest", "start", "end", "replacement", "actorId"]);
    const unit = units.get(edit.unitId);
    if (typeof edit.id !== "string" || edit.id.length === 0 || ids.has(edit.id)) throw new Error("EDIT_ID_INVALID");
    if (!unit || actions.get(edit.unitId) !== "edit" || unit.kind !== "prose") throw new Error("EDIT_UNIT_BINDING_INVALID");
    requireDigest(edit.sourceDigest, "edit sourceDigest");
    if (edit.sourceDigest !== manifest.sourceDigest) throw new Error("EDIT_SOURCE_DIGEST_MISMATCH");
    if (edit.actorId !== value.actorId) throw new Error("EDIT_ACTOR_BINDING_MISMATCH");
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < unit.start || edit.end > unit.end || edit.end < edit.start || !isUtf16Boundary(source, edit.start) || !isUtf16Boundary(source, edit.end)) throw new Error("EDIT_RANGE_INVALID");
    if (typeof edit.replacement !== "string") throw new Error("EDIT_REPLACEMENT_INVALID");
    ids.add(edit.id);
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) throw new Error("EDIT_RANGES_OVERLAP");
  }
  const candidate = applyEdits(source, sorted);
  if (sha256(candidate) !== value.candidateDigest) throw new Error("EDITING_CANDIDATE_DIGEST_MISMATCH");
  return { value, candidate, edits: sorted };
}

export function validateVerificationWorkProduct(value, { manifest, editing, rubricDigest }) {
  requireExactObject(value, "verification-work-product", ["schemaVersion", "actorId", "sourceDigest", "editingDigest", "rubricDigest", "globalDecision", "decisions", "assessment"]);
  requireSchemaVersion(value);
  requireActor(value.actorId, "verification actorId");
  requireDigest(value.sourceDigest, "verification sourceDigest");
  requireDigest(value.editingDigest, "verification editingDigest");
  requireDigest(value.rubricDigest, "verification rubricDigest");
  if (value.sourceDigest !== manifest.sourceDigest) throw new Error("VERIFICATION_SOURCE_DIGEST_MISMATCH");
  if (value.editingDigest !== workProductDigest(editing)) throw new Error("VERIFICATION_EDITING_DIGEST_MISMATCH");
  if (value.rubricDigest !== rubricDigest) throw new Error("VERIFICATION_RUBRIC_DIGEST_MISMATCH");
  if (value.globalDecision !== "continue" && value.globalDecision !== "fallback") throw new Error("VERIFICATION_GLOBAL_DECISION_INVALID");
  if (!Array.isArray(value.decisions)) throw new Error("VERIFICATION_DECISIONS_INVALID");
  const editIds = new Set(editing.edits.map((edit) => edit.id));
  const seen = new Set();
  for (const decision of value.decisions) {
    requireExactObject(decision, "verification decision", ["editId", "decision", "reasonCode"]);
    if (!editIds.has(decision.editId) || seen.has(decision.editId)) throw new Error("VERIFICATION_EDIT_BINDING_INVALID");
    if (decision.decision !== "accept" && decision.decision !== "retain") throw new Error("VERIFICATION_EDIT_DECISION_INVALID");
    if (typeof decision.reasonCode !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(decision.reasonCode)) throw new Error("VERIFICATION_REASON_CODE_INVALID");
    if (decision.decision === "accept" && decision.reasonCode !== "MEANING_PRESERVED") throw new Error("VERIFICATION_REASON_DECISION_CONFLICT");
    seen.add(decision.editId);
  }
  if (seen.size !== editIds.size) throw new Error("VERIFICATION_DECISION_COVERAGE_MISMATCH");
  requireExactObject(value.assessment, "verification assessment", ["meaningPreservation", "majorMeaningChange", "registerCompliance", "protectedStrings", "terminologyJudgment", "pairPreference"]);
  for (const field of ["meaningPreservation", "registerCompliance", "protectedStrings"]) {
    if (!["pass", "fail", "uncertain"].includes(value.assessment[field])) throw new Error(`VERIFICATION_${field.toUpperCase()}_INVALID`);
  }
  if (!["pass", "fail", "uncertain", "not-applicable"].includes(value.assessment.terminologyJudgment)) throw new Error("VERIFICATION_TERMINOLOGY_INVALID");
  if (!["candidate", "original", "tie", "neither"].includes(value.assessment.pairPreference)) throw new Error("VERIFICATION_PAIR_PREFERENCE_INVALID");
  if (typeof value.assessment.majorMeaningChange !== "boolean") throw new Error("VERIFICATION_MAJOR_MEANING_CHANGE_INVALID");
  return value;
}

export function evaluateStructuredCase({ input, expectedDecision, manifest, selection, editing, verification, rubricDigest }) {
  validateSourceUnitManifest(manifest, input.sourceText);
  validateSelectionWorkProduct(selection, manifest);
  const editingResult = validateEditingWorkProduct(editing, { source: input.sourceText, manifest, selection });
  validateVerificationWorkProduct(verification, { manifest, editing, rubricDigest });
  if (new Set([selection.actorId, editing.actorId, verification.actorId]).size !== 3) throw new Error("ROLE_ACTOR_REUSE");

  const finalized = finalizeEvaluationCase({
    sourceText: input.sourceText,
    protectedStrings: input.protectedStrings ?? [],
    actorIds: [selection.actorId, editing.actorId, verification.actorId],
    sourceUnitManifest: manifest,
    selection,
    editing,
    verification,
    rubricDigest,
  });
  const decisionById = new Map(verification.decisions.map((decision) => [decision.editId, decision]));
  return {
    id: input.id,
    suite: input.suite,
    sourceText: input.sourceText,
    expectedDecision,
    candidateText: editingResult.candidate,
    finalText: finalized.finalText,
    finalAction: finalized.finalAction,
    selectedEdit: selection.decisions.some((decision) => decision.action === "edit"),
    editResults: editingResult.edits.map((edit) => ({
      editId: edit.id,
      unitId: edit.unitId,
      decision: finalized.receipt.decisions.appliedEditDigests.includes(sha256(edit.id)) ? "accept" : "retain",
      reasonCode: verification.globalDecision === "fallback" ? "GLOBAL_FALLBACK" : decisionById.get(edit.id).reasonCode,
    })),
    verification: verification.assessment,
    protectedStrings: input.protectedStrings ?? [],
    receipt: finalized.receipt,
  };
}

export function aggregateStructuredRun({ run, input, key, manifests, selections, editings, verifications, rubricDigest, thresholds, diagnosticInventory = null, candidateCommit = null }) {
  if (!Number.isInteger(run) || run < 1 || run > RUN_BUDGET) throw new Error("RUN_OUTSIDE_FROZEN_BUDGET");
  const products = { manifests, selections, editings, verifications };
  for (const [name, records] of Object.entries(products)) {
    if (!Array.isArray(records) || records.length !== input.length) throw new Error(`${name.toUpperCase()}_COUNT_MISMATCH`);
  }
  assertReleaseThresholds(thresholds);
  const keyById = new Map(key.map((item) => [item.id, item.expectedDecision]));
  const finals = input.map((item, index) => evaluateStructuredCase({
    input: item,
    expectedDecision: keyById.get(item.id),
    manifest: manifests[index],
    selection: selections[index],
    editing: editings[index],
    verification: verifications[index],
    rubricDigest,
  }));
  if (keyById.size !== input.length || finals.some((item) => !["edit", "retain", "defer"].includes(item.expectedDecision))) throw new Error("EVALUATION_KEY_MISMATCH");

  const actorSets = [selections, editings, verifications].map((records) => new Set(records.map((record) => record.actorId)));
  if (actorSets.some((actors) => actors.size !== 1)) throw new Error("ROLE_ACTOR_CHANGED_WITHIN_RUN");
  const actors = actorSets.map((actors) => [...actors][0]);
  if (new Set(actors).size !== 3) throw new Error("ROLE_ACTOR_REUSE");

  const legacy = finals.filter((item) => item.suite === "legacy-100");
  const holdout = finals.filter((item) => item.suite === "holdout-30");
  const release = {
    protectedExactRate: rate(finals.filter((item) => protectedEqual(item.inputText ?? input.find((source) => source.id === item.id).sourceText, item.finalText, item.protectedStrings)).length, finals.length),
    legacyMeaningPassRate: rate(legacy.filter((item) => item.finalText === input.find((source) => source.id === item.id).sourceText || item.verification.meaningPreservation === "pass").length, legacy.length),
    legacyImprovementRate: improvementRate(legacy),
    legacyRegressionRate: regressionRate(legacy, input),
    legacyRestraintSuccessRate: restraintRate(legacy, input),
    holdoutMajorMeaningFailures: holdout.filter((item) => item.finalText !== input.find((source) => source.id === item.id).sourceText && item.verification.majorMeaningChange).length,
    holdoutProtectedFailures: holdout.filter((item) => !protectedEqual(input.find((source) => source.id === item.id).sourceText, item.finalText, item.protectedStrings)).length,
    holdoutImprovementRate: improvementRate(holdout),
    holdoutRestraintSuccessRate: restraintRate(holdout, input),
    roleReuse: 0,
    missingEvidence: 0,
    rubricChanges: 0,
  };
  const diagnostic = diagnosticInventory ? diagnosticMetrics(finals, diagnosticInventory) : null;
  const metrics = {
    schemaVersion: "2.0.0",
    run,
    candidateCommit,
    actorIds: actors,
    counts: {
      cases: finals.length,
      proposedEdits: finals.reduce((total, item) => total + item.editResults.length, 0),
      acceptedEdits: finals.reduce((total, item) => total + item.editResults.filter((edit) => edit.decision === "accept").length, 0),
      retainedEdits: finals.reduce((total, item) => total + item.editResults.filter((edit) => edit.decision === "retain").length, 0),
    },
    release,
    diagnostic,
  };
  metrics.gate = {
    releasePass: releaseGate(release, thresholds),
    diagnosticPass: diagnostic === null ? null : diagnostic.editRecallCount >= diagnosticInventory.thresholds.editRecallMinimum &&
      diagnostic.restraintCount >= diagnosticInventory.thresholds.restraintMinimum &&
      (diagnostic.userFacingJargon === null || diagnostic.userFacingJargon.pass),
  };
  return { finals, metrics };
}

export function validateRunMetadata({ run, inputSha256, products, metas }) {
  for (const role of ["selection", "editing", "verification"]) {
    const meta = metas[role];
    const records = products[role];
    requireExactObject(meta, `${role} meta`, ["schemaVersion", "run", "role", "actorId", "caseCount", "inputSha256", "workProductSha256", "status"]);
    if (meta.schemaVersion !== "2.0.0" || meta.run !== run || meta.role !== role || meta.status !== "complete") throw new Error(`ROLE_META_IDENTITY_MISMATCH:${role}`);
    if (!Array.isArray(records) || meta.caseCount !== records.length) throw new Error(`ROLE_META_CASE_COUNT_MISMATCH:${role}`);
    if (meta.inputSha256 !== inputSha256) throw new Error(`ROLE_META_INPUT_DIGEST_MISMATCH:${role}`);
    if (meta.workProductSha256 !== sha256(stableJson(records))) throw new Error(`ROLE_META_OUTPUT_DIGEST_MISMATCH:${role}`);
    if (new Set(records.map((record) => record.actorId)).size !== 1 || records[0]?.actorId !== meta.actorId) throw new Error(`ROLE_META_ACTOR_BINDING_MISMATCH:${role}`);
  }
}

export async function writeNewFile(file, contents) {
  try {
    await access(file);
    throw new Error(`REFUSE_OVERWRITE:${file}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents, { encoding: "utf8", flag: "wx" });
}

export async function digestFile(file) {
  return sha256(await readFile(file));
}

export function assertReleaseThresholds(thresholds) {
  requireExactObject(thresholds, "release thresholds", RELEASE_THRESHOLD_KEYS);
  for (const key of RELEASE_THRESHOLD_KEYS) {
    if (typeof thresholds[key] !== "number" || !Number.isFinite(thresholds[key])) throw new Error(`RELEASE_THRESHOLD_INVALID:${key}`);
  }
}

function diagnosticMetrics(finals, inventory) {
  if (!Array.isArray(inventory.editCases) || inventory.editCases.length !== 18) throw new Error("DIAGNOSTIC_EDIT_INVENTORY_COUNT");
  if (!Array.isArray(inventory.controlCases) || inventory.controlCases.length !== 20) throw new Error("DIAGNOSTIC_CONTROL_INVENTORY_COUNT");
  if (inventory.thresholds?.editRecallMinimum !== 15 || inventory.thresholds?.restraintMinimum !== 18) throw new Error("DIAGNOSTIC_THRESHOLDS_CHANGED");
  const byId = new Map(finals.map((item) => [item.id, item]));
  for (const item of [...inventory.editCases, ...inventory.controlCases]) {
    if (!byId.has(item.caseId)) throw new Error(`DIAGNOSTIC_CASE_MISSING:${item.caseId}`);
  }
  const regressionRecords = (inventory.regressionCases ?? []).map((item) => byId.get(item.caseId)).filter(Boolean);
  const userFacingJargon = regressionRecords.length === 0 ? null : {
    caseCount: regressionRecords.length,
    protectedExactRate: rate(regressionRecords.filter((item) => protectedEqual(item.sourceText, item.finalText, item.protectedStrings)).length, regressionRecords.length),
    candidatePreferenceCount: regressionRecords.filter((item) => item.verification.pairPreference === "candidate").length,
    pass: regressionRecords.every((item) => protectedEqual(item.sourceText, item.finalText, item.protectedStrings) && item.verification.pairPreference === "candidate" && item.finalAction === "edit"),
  };
  return {
    editRecallCount: inventory.editCases.filter((item) => byId.get(item.caseId).selectedEdit === true).length,
    editRecallDenominator: 18,
    restraintCount: inventory.controlCases.filter((item) => byId.get(item.caseId).selectedEdit === false).length,
    restraintDenominator: 20,
    userFacingJargon,
  };
}

function improvementRate(records) {
  const expected = records.filter((item) => item.expectedDecision === "edit");
  return rate(expected.filter((item) => item.finalAction === "edit" && item.verification.pairPreference === "candidate").length, expected.length);
}

function restraintRate(records, input) {
  const sourceById = new Map(input.map((item) => [item.id, item.sourceText]));
  const expected = records.filter((item) => item.expectedDecision === "retain" || item.expectedDecision === "defer");
  return rate(expected.filter((item) => item.finalText === sourceById.get(item.id)).length, expected.length);
}

function regressionRate(records, input) {
  const sourceById = new Map(input.map((item) => [item.id, item.sourceText]));
  return rate(records.filter((item) => item.finalText !== sourceById.get(item.id) && (
    item.verification.pairPreference === "original" || item.verification.pairPreference === "neither" ||
    item.verification.meaningPreservation !== "pass" || item.verification.registerCompliance !== "pass" ||
    item.verification.protectedStrings !== "pass" || item.verification.terminologyJudgment === "fail"
  )).length, records.length);
}

function releaseGate(metrics, thresholds) {
  return metrics.protectedExactRate >= thresholds.protectedExactRate &&
    metrics.legacyMeaningPassRate >= thresholds.legacyMeaningPassRate &&
    metrics.legacyImprovementRate >= thresholds.legacyImprovementRate &&
    metrics.legacyRegressionRate <= thresholds.legacyRegressionRateMax &&
    metrics.legacyRestraintSuccessRate >= thresholds.legacyRestraintSuccessRate &&
    metrics.holdoutMajorMeaningFailures <= thresholds.holdoutMajorMeaningFailuresMax &&
    metrics.holdoutProtectedFailures <= thresholds.holdoutProtectedFailuresMax &&
    metrics.holdoutImprovementRate >= thresholds.holdoutImprovementRate &&
    metrics.holdoutRestraintSuccessRate >= thresholds.holdoutRestraintSuccessRate &&
    metrics.roleReuse <= thresholds.roleReuseMax && metrics.missingEvidence <= thresholds.missingEvidenceMax &&
    metrics.rubricChanges <= thresholds.rubricChangesMax;
}

function applyEdits(source, edits) {
  let output = source;
  for (const edit of [...edits].sort((left, right) => compareEdits(right, left))) {
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }
  return output;
}

function compareEdits(left, right) {
  return left.start - right.start || left.end - right.end || left.id.localeCompare(right.id);
}

function protectedEqual(source, target, values) {
  return values.every((value) => count(source, value) === count(target, value) && firstIndexOrder(source, values).join("\u0000") === firstIndexOrder(target, values).join("\u0000"));
}

function firstIndexOrder(text, values) {
  return values.filter((value) => text.includes(value)).map((value) => [value, text.indexOf(value)]).sort((left, right) => left[1] - right[1]).map(([value]) => value);
}

function count(text, value) {
  if (!value) return 0;
  let total = 0;
  let offset = 0;
  while ((offset = text.indexOf(value, offset)) !== -1) {
    total += 1;
    offset += value.length;
  }
  return total;
}

function rate(numerator, denominator) {
  return denominator === 0 ? 100 : Number(((numerator / denominator) * 100).toFixed(2));
}

function isUtf16Boundary(source, index) {
  if (index <= 0 || index >= source.length) return true;
  const before = source.charCodeAt(index - 1);
  const after = source.charCodeAt(index);
  return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF);
}

function requireSchemaVersion(value) {
  if (value.schemaVersion !== WORK_PRODUCT_SCHEMA_VERSION) throw new Error("WORK_PRODUCT_SCHEMA_VERSION");
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new Error(`${label} invalid`);
}

function requireActor(value, label) {
  if (typeof value !== "string" || !ACTOR_ID.test(value)) throw new Error(`${label} invalid`);
}

function requireExactObject(value, label, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} fields mismatch`);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  return value;
}
