import { randomUUID } from "node:crypto";
import { access, link, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  parseJsonl,
  serializeJsonl,
  sha256,
  stableJson,
  validateSourceUnitManifest,
  workProductDigest,
} from "./evaluation-cycle.mjs";

const ACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTOR_ID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gu;
const SOURCE_DEFECTS = new Set([
  "GRAMMATICAL_MISMATCH", "NOUN_STACKING", "REDUNDANCY", "TRANSLATIONESE",
  "UNNECESSARY_META_PROSE", "UNSUPPORTED_EMPHASIS", "USER_FACING_IMPLEMENTATION_JARGON", "NONE",
]);
const INVARIANT_DELTAS = new Set([
  "NONE", "QUANTIFIER_SCOPE", "CONDITION_OR_TENSE", "MODALITY_OR_CERTAINTY", "ACTION_OR_AUTHORITY",
  "CLAIM_TYPE_OR_STRENGTH", "PREDICATE_ARGUMENT_STRUCTURE", "RHETORICAL_FUNCTION", "ACTOR_OR_TARGET",
  "TIME", "NEGATION", "CAUSAL_RELATION", "TERMINOLOGY", "UNCERTAIN",
]);
const SAFETY_REASON_CODES = new Set(["MEANING_CHANGED", "PROTECTED_STRING_CHANGED", "REGISTER_CHANGED", "UNCERTAIN"]);
const FRAME_BINDING_FILES = Object.freeze([
  "evals/cycles/0.1.0-rc2/INDEPENDENT-DELIBERATION.md",
  "evals/cycles/0.1.0-rc2/EVALUATION_PROTOCOL.md",
  "evals/cycles/0.1.0-rc2/thresholds.json",
  "evals/cycles/0.1.0-rc2/diagnostic/semantic-regression/new-candidates/input.jsonl",
  "evals/cycles/0.1.0-rc2/diagnostic/semantic-regression/new-candidates/key.json",
  "evals/cycles/0.1.0-rc2/diagnostic/semantic-regression/new-candidates/source-unit-manifest.jsonl",
  "evals/cycles/0.1.0-rc2/diagnostic/semantic-regression/feasibility-calibration/contract.json",
  "evals/cycles/0.1.0-rc2/diagnostic/semantic-regression/feasibility-calibration/schemas/canonical-candidate-draft.v1.schema.json",
  "evals/cycles/0.1.0-rc2/diagnostic/semantic-regression/feasibility-calibration/schemas/canonical-candidate.v1.schema.json",
  "evals/cycles/0.1.0-rc2/diagnostic/semantic-regression/feasibility-calibration/schemas/verification-draft.v1.schema.json",
  "evals/cycles/0.1.0-rc2/diagnostic/semantic-regression/feasibility-calibration/schemas/verification-work-product.v1.schema.json",
  "skills/korean-prose-editor/references/editing-policy.md",
  "skills/korean-prose-editor/references/verification-rubric.md",
  "scripts/lib/feasibility-calibration.mjs",
  "scripts/prepare-feasibility-calibration.mjs",
  "scripts/record-feasibility-candidates.mjs",
  "scripts/record-feasibility-verification.mjs",
  "scripts/finalize-feasibility-calibration.mjs",
]);

export function resolveCalibrationPaths(repositoryRoot, cycleDirectory) {
  const root = path.resolve(repositoryRoot);
  const cyclesRoot = path.join(root, "evals", "cycles");
  const cycle = path.resolve(root, cycleDirectory);
  if (cycle === cyclesRoot || !cycle.startsWith(`${cyclesRoot}${path.sep}`)) {
    throw new Error("cycle directory must be a child of evals/cycles");
  }
  const candidates = path.join(cycle, "diagnostic", "semantic-regression", "new-candidates");
  const calibration = path.join(cycle, "diagnostic", "semantic-regression", "feasibility-calibration");
  return { root, cycle, candidates, calibration };
}

export async function loadCalibrationFrame({ repositoryRoot, cycleDirectory }) {
  const paths = resolveCalibrationPaths(repositoryRoot, cycleDirectory);
  const bindingEntries = await Promise.all(FRAME_BINDING_FILES.map(async (relative) => {
    const contents = await readFile(path.join(paths.root, relative), "utf8");
    return [relative, contents];
  }));
  const bindingTexts = Object.fromEntries(bindingEntries);
  const contract = JSON.parse(bindingTexts[calibrationRelative("contract.json")]);
  validateCalibrationContract(contract);
  const inputText = bindingTexts[candidateRelative("input.jsonl")];
  const manifestText = bindingTexts[candidateRelative("source-unit-manifest.jsonl")];
  const keyText = bindingTexts[candidateRelative("key.json")];
  const input = parseJsonl(inputText);
  const manifests = parseJsonl(manifestText);
  const key = JSON.parse(keyText);
  if (input.length !== contract.thresholds.caseCount || manifests.length !== input.length || key.length !== input.length) {
    throw new Error("FEASIBILITY_CASE_COUNT_MISMATCH");
  }
  if (new Set(input.map((item) => item.id)).size !== input.length ||
      stableJson(input.map((item) => item.id)) !== stableJson(key.map((item) => item.id)) ||
      key.some((item) => item.expectedDecision !== "edit")) {
    throw new Error("FEASIBILITY_CASE_KEY_MISMATCH");
  }
  for (let index = 0; index < input.length; index += 1) validateSourceUnitManifest(manifests[index], input[index].sourceText);
  const schemaFiles = {
    candidateDraft: calibrationRelative("schemas/canonical-candidate-draft.v1.schema.json"),
    candidate: calibrationRelative("schemas/canonical-candidate.v1.schema.json"),
    verificationDraft: calibrationRelative("schemas/verification-draft.v1.schema.json"),
    verification: calibrationRelative("schemas/verification-work-product.v1.schema.json"),
  };
  const validators = Object.fromEntries(Object.entries(schemaFiles).map(([name, relative]) => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    return [name, ajv.compile(JSON.parse(bindingTexts[relative]))];
  }));
  const prior = await collectPriorAttemptEvidence(paths.candidates);
  const bindings = Object.fromEntries(bindingEntries.map(([relative, contents]) => [relative, sha256(contents)]));
  bindings.priorAttemptEvidenceSha256 = prior.digest;
  return { paths, contract, input, manifests, key, inputText, bindingTexts, bindings, prior, validators };
}

export function buildCalibrationFreeze(frame) {
  const requestArtifactDigest = sha256(stableJson({ contract: frame.contract, bindings: frame.bindings, priorActorIds: frame.prior.actorIds }));
  return {
    schemaVersion: "1.0.0",
    calibrationId: frame.contract.calibrationId,
    purpose: frame.contract.purpose,
    comparableToPriorAttempts: false,
    executionBudget: 1,
    requestArtifactDigest,
    frameDigest: sha256(stableJson({ requestArtifactDigest, authorities: frame.contract.authorities, thresholds: frame.contract.thresholds })),
    bindings: frame.bindings,
    priorActorIds: frame.prior.actorIds,
  };
}

export async function prepareFeasibilityCalibration(options) {
  const frame = await loadCalibrationFrame(options);
  const freeze = buildCalibrationFreeze(frame);
  await writeNewFileAtomically(path.join(frame.paths.calibration, "FREEZE.json"), `${JSON.stringify(freeze, null, 2)}\n`);
  return freeze;
}

export async function loadVerifiedCalibration(options) {
  const frame = await loadCalibrationFrame(options);
  const freeze = JSON.parse(await readFile(path.join(frame.paths.calibration, "FREEZE.json"), "utf8"));
  const expected = buildCalibrationFreeze(frame);
  if (stableJson(freeze) !== stableJson(expected)) throw new Error("FEASIBILITY_FREEZE_MISMATCH");
  return { ...frame, freeze, freezeDigest: workProductDigest(freeze) };
}

export function sealCanonicalCandidates(frame, drafts) {
  const { contract, input, manifests, prior, validators } = frame;
  if (!Array.isArray(drafts) || drafts.length !== contract.thresholds.caseCount) throw new Error("FEASIBILITY_DRAFT_COUNT_MISMATCH");
  if (stableJson(drafts.map((item) => item.caseId)) !== stableJson(input.map((item) => item.id))) throw new Error("FEASIBILITY_DRAFT_ORDER_MISMATCH");
  const editorActors = new Set(drafts.map((item) => item.editorActorId));
  const adjudicatorActors = new Set(drafts.map((item) => item.adjudicatorActorId));
  if (editorActors.size !== 1 || adjudicatorActors.size !== 1) throw new Error("FEASIBILITY_CANONICAL_ACTOR_CHANGED");
  const editorActorId = [...editorActors][0];
  const adjudicatorActorId = [...adjudicatorActors][0];
  requireActor(editorActorId, "editorActorId");
  requireActor(adjudicatorActorId, "adjudicatorActorId");
  if (editorActorId === adjudicatorActorId || prior.actorIds.includes(editorActorId) || prior.actorIds.includes(adjudicatorActorId)) {
    throw new Error("FEASIBILITY_CANONICAL_ACTOR_REUSE");
  }
  const editIds = new Set();
  const records = drafts.map((draft, index) => {
    validateWith(validators.candidateDraft, draft, `canonical draft ${index + 1}`);
    const source = input[index].sourceText;
    const manifest = manifests[index];
    if (draft.schemaVersion !== "1.0.0" || draft.calibrationId !== contract.calibrationId || draft.caseId !== input[index].id) {
      throw new Error("FEASIBILITY_DRAFT_IDENTITY_MISMATCH");
    }
    let candidate = source;
    if (draft.disposition === "edit") {
      validateCanonicalEdit(draft.edit, { source, manifest, editorActorId, editIds, protectedStrings: input[index].protectedStrings ?? [] });
      candidate = applySingleEdit(source, draft.edit);
    } else if (draft.edit !== null) {
      throw new Error("FEASIBILITY_INFEASIBLE_HAS_EDIT");
    }
    const record = {
      schemaVersion: "1.0.0",
      calibrationId: contract.calibrationId,
      caseId: input[index].id,
      editorActorId,
      adjudicatorActorId,
      sourceDigest: sha256(source),
      meaningConstraintsDigest: sha256(stableJson(input[index].meaningConstraints ?? [])),
      disposition: draft.disposition,
      rationaleCode: draft.rationaleCode,
      edit: draft.edit,
      candidateDigest: sha256(candidate),
    };
    validateWith(validators.candidate, record, `canonical candidate ${index + 1}`);
    if (!protectedEqual(source, candidate, input[index].protectedStrings ?? [])) throw new Error("FEASIBILITY_PROTECTED_STRING_CHANGED");
    return record;
  });
  return {
    records,
    meta: {
      schemaVersion: "1.0.0",
      calibrationId: contract.calibrationId,
      editorActorId,
      adjudicatorActorId,
      caseCount: records.length,
      editCount: records.filter((item) => item.disposition === "edit").length,
      inputSha256: sha256(frame.inputText),
      candidateSetDigest: workProductDigest(records),
      freezeDigest: frame.freezeDigest,
      status: "complete",
    },
  };
}

export async function recordFeasibilityCandidates(options) {
  const frame = await loadVerifiedCalibration(options);
  const draftFile = path.resolve(frame.paths.calibration, options.draftFile ?? "drafts/canonical-candidates.jsonl");
  requireChildPath(frame.paths.calibration, draftFile, "candidate draft");
  const drafts = parseJsonl(await readFile(draftFile, "utf8"));
  const sealed = sealCanonicalCandidates(frame, drafts);
  await writeDirectoryAtomically(path.join(frame.paths.calibration, "canonical"), {
    "candidate-set.jsonl": serializeJsonl(sealed.records),
    "meta.json": `${JSON.stringify(sealed.meta, null, 2)}\n`,
  });
  return sealed.meta;
}

export function sealFeasibilityVerification(frame, canonical, drafts, { run, usedActorIds = [] }) {
  if (!Number.isInteger(run) || run < 1 || run > frame.contract.thresholds.verifierCount) throw new Error("FEASIBILITY_RUN_INVALID");
  if (!Array.isArray(drafts) || drafts.length !== canonical.records.length) throw new Error("FEASIBILITY_VERIFICATION_COUNT_MISMATCH");
  if (stableJson(drafts.map((item) => item.caseId)) !== stableJson(canonical.records.map((item) => item.caseId))) {
    throw new Error("FEASIBILITY_VERIFICATION_ORDER_MISMATCH");
  }
  const actors = new Set(drafts.map((item) => item.actorId));
  if (actors.size !== 1) throw new Error("FEASIBILITY_VERIFIER_CHANGED_WITHIN_RUN");
  const actorId = [...actors][0];
  requireActor(actorId, "verification actorId");
  const forbiddenActors = new Set([canonical.meta.editorActorId, canonical.meta.adjudicatorActorId, ...frame.prior.actorIds, ...usedActorIds]);
  if (forbiddenActors.has(actorId)) throw new Error("FEASIBILITY_VERIFIER_ACTOR_REUSE");
  const records = drafts.map((draft, index) => {
    validateWith(frame.validators.verificationDraft, draft, `verification draft ${index + 1}`);
    const candidate = canonical.records[index];
    if (draft.schemaVersion !== "1.0.0" || draft.calibrationId !== frame.contract.calibrationId || draft.caseId !== candidate.caseId ||
        draft.canonicalCandidateDigest !== workProductDigest(candidate) || draft.candidateDigest !== candidate.candidateDigest) {
      throw new Error("FEASIBILITY_VERIFICATION_BINDING_MISMATCH");
    }
    validateVerificationDecision(draft, candidate.disposition);
    const record = { ...draft, candidateSetDigest: canonical.meta.candidateSetDigest };
    validateWith(frame.validators.verification, record, `verification work product ${index + 1}`);
    return record;
  });
  return {
    records,
    meta: {
      schemaVersion: "1.0.0",
      calibrationId: frame.contract.calibrationId,
      run,
      role: "verification",
      actorId,
      caseCount: records.length,
      inputSha256: sha256(frame.inputText),
      candidateSetDigest: canonical.meta.candidateSetDigest,
      workProductSha256: workProductDigest(records),
      freezeDigest: frame.freezeDigest,
      status: "complete",
    },
  };
}

export async function recordFeasibilityVerification(options) {
  const frame = await loadVerifiedCalibration(options);
  const canonical = await loadCanonicalArtifacts(frame);
  const run = Number(options.run);
  const usedActorIds = [];
  for (let existingRun = 1; existingRun <= frame.contract.thresholds.verifierCount; existingRun += 1) {
    if (existingRun === run) continue;
    const metaFile = path.join(frame.paths.calibration, "runs", `run-${existingRun}`, "meta.json");
    if (await exists(metaFile)) usedActorIds.push(JSON.parse(await readFile(metaFile, "utf8")).actorId);
  }
  const draftFile = path.resolve(frame.paths.calibration, options.draftFile ?? `drafts/verification-run-${run}.jsonl`);
  requireChildPath(frame.paths.calibration, draftFile, "verification draft");
  const drafts = parseJsonl(await readFile(draftFile, "utf8"));
  const sealed = sealFeasibilityVerification(frame, canonical, drafts, { run, usedActorIds });
  await writeDirectoryAtomically(path.join(frame.paths.calibration, "runs", `run-${run}`), {
    "verification-work-product.jsonl": serializeJsonl(sealed.records),
    "meta.json": `${JSON.stringify(sealed.meta, null, 2)}\n`,
  });
  return sealed.meta;
}

export function buildFeasibilityResult(frame, canonical, verificationRuns) {
  if (!Array.isArray(verificationRuns) || verificationRuns.length !== frame.contract.thresholds.verifierCount) {
    throw new Error("FEASIBILITY_EXACTLY_THREE_VERIFIERS_REQUIRED");
  }
  const verifierActors = verificationRuns.map((item) => item.meta.actorId);
  if (new Set(verifierActors).size !== verifierActors.length) throw new Error("FEASIBILITY_GLOBAL_VERIFIER_REUSE");
  const cases = canonical.records.map((candidate, index) => {
    const decisions = verificationRuns.map((item, runIndex) => {
      const decision = item.records[index];
      if (decision.caseId !== candidate.caseId || decision.candidateSetDigest !== canonical.meta.candidateSetDigest) {
        throw new Error("FEASIBILITY_FINAL_BINDING_MISMATCH");
      }
      return {
        run: runIndex + 1,
        actorId: decision.actorId,
        independentValidity: decision.independentValidity,
        safetyFailure: decision.safetyFailure,
        decision: decision.decision,
        reasonCode: decision.reasonCode,
        sourceDefect: decision.sourceDefect,
        invariantDelta: decision.invariantDelta,
      };
    });
    return {
      caseId: candidate.caseId,
      disposition: candidate.disposition,
      candidateDigest: candidate.candidateDigest,
      unanimousAccepted: candidate.disposition === "edit" && decisions.every((item) => item.decision === "accept" && item.independentValidity === "pass"),
      safetyFailure: decisions.some((item) => item.safetyFailure),
      decisions,
    };
  });
  const unanimousEditAcceptCount = cases.filter((item) => item.unanimousAccepted).length;
  const safetyFailureCount = cases.filter((item) => item.safetyFailure).length;
  const pass = unanimousEditAcceptCount >= frame.contract.thresholds.unanimousEditAcceptMinimum &&
    safetyFailureCount <= frame.contract.thresholds.safetyFailureMaximum;
  return {
    schemaVersion: "1.0.0",
    calibrationId: frame.contract.calibrationId,
    status: pass ? "passed-feasibility" : "failed-feasibility",
    purpose: frame.contract.purpose,
    comparableToPriorAttempts: false,
    releaseDecision: "not-evaluated",
    executionCount: 1,
    executionBudget: frame.contract.executionBudget,
    authorities: frame.contract.authorities,
    thresholds: frame.contract.thresholds,
    candidateSetDigest: canonical.meta.candidateSetDigest,
    freezeDigest: frame.freezeDigest,
    actorIds: {
      editor: canonical.meta.editorActorId,
      adjudicator: canonical.meta.adjudicatorActorId,
      verifiers: verifierActors,
    },
    counts: {
      cases: cases.length,
      canonicalEdits: canonical.meta.editCount,
      infeasible: cases.filter((item) => item.disposition === "infeasible").length,
      unanimousEditAccept: unanimousEditAcceptCount,
      safetyFailures: safetyFailureCount,
    },
    cases,
    nextStep: pass ? frame.contract.outcomeRoutes.passed : frame.contract.outcomeRoutes.failed,
    forbiddenActionsStillApply: frame.contract.forbiddenActions,
  };
}

export async function finalizeFeasibilityCalibration(options) {
  const frame = await loadVerifiedCalibration(options);
  const canonical = await loadCanonicalArtifacts(frame);
  const runs = [];
  for (let run = 1; run <= frame.contract.thresholds.verifierCount; run += 1) {
    runs.push(await loadVerificationArtifacts(frame, canonical, run, runs.map((item) => item.meta.actorId)));
  }
  const result = buildFeasibilityResult(frame, canonical, runs);
  await writeNewFileAtomically(path.join(frame.paths.calibration, "final-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function writeNewFileAtomically(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  if (await exists(file)) throw new Error(`REFUSE_OVERWRITE:${file}`);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.staging-${randomUUID()}`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await link(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function writeDirectoryAtomically(directory, files) {
  await mkdir(path.dirname(directory), { recursive: true });
  if (await exists(directory)) throw new Error(`REFUSE_OVERWRITE:${directory}`);
  const staging = path.join(path.dirname(directory), `.${path.basename(directory)}.staging-${randomUUID()}`);
  await mkdir(staging);
  try {
    for (const [name, contents] of Object.entries(files)) {
      if (path.basename(name) !== name) throw new Error("ATOMIC_DIRECTORY_FILE_NAME_INVALID");
      await writeFile(path.join(staging, name), contents, { encoding: "utf8", flag: "wx" });
    }
    await rename(staging, directory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function loadCanonicalArtifacts(frame) {
  const directory = path.join(frame.paths.calibration, "canonical");
  const records = parseJsonl(await readFile(path.join(directory, "candidate-set.jsonl"), "utf8"));
  const meta = JSON.parse(await readFile(path.join(directory, "meta.json"), "utf8"));
  assertExactKeys(meta, "canonical meta", ["schemaVersion", "calibrationId", "editorActorId", "adjudicatorActorId", "caseCount", "editCount", "inputSha256", "candidateSetDigest", "freezeDigest", "status"]);
  if (meta.schemaVersion !== "1.0.0" || meta.calibrationId !== frame.contract.calibrationId || meta.caseCount !== records.length ||
      meta.editCount !== records.filter((item) => item.disposition === "edit").length || meta.inputSha256 !== sha256(frame.inputText) ||
      meta.candidateSetDigest !== workProductDigest(records) || meta.freezeDigest !== frame.freezeDigest || meta.status !== "complete") {
    throw new Error("FEASIBILITY_CANONICAL_META_INVALID");
  }
  if (meta.editorActorId === meta.adjudicatorActorId || frame.prior.actorIds.includes(meta.editorActorId) || frame.prior.actorIds.includes(meta.adjudicatorActorId)) {
    throw new Error("FEASIBILITY_CANONICAL_ACTOR_REUSE");
  }
  for (let index = 0; index < records.length; index += 1) validateSealedCandidate(frame, records[index], index, meta);
  return { records, meta };
}

async function loadVerificationArtifacts(frame, canonical, run, usedActorIds) {
  const directory = path.join(frame.paths.calibration, "runs", `run-${run}`);
  const records = parseJsonl(await readFile(path.join(directory, "verification-work-product.jsonl"), "utf8"));
  const meta = JSON.parse(await readFile(path.join(directory, "meta.json"), "utf8"));
  assertExactKeys(meta, "verification meta", ["schemaVersion", "calibrationId", "run", "role", "actorId", "caseCount", "inputSha256", "candidateSetDigest", "workProductSha256", "freezeDigest", "status"]);
  if (meta.schemaVersion !== "1.0.0" || meta.calibrationId !== frame.contract.calibrationId || meta.run !== run || meta.role !== "verification" ||
      meta.caseCount !== records.length || meta.inputSha256 !== sha256(frame.inputText) || meta.candidateSetDigest !== canonical.meta.candidateSetDigest ||
      meta.workProductSha256 !== workProductDigest(records) || meta.freezeDigest !== frame.freezeDigest || meta.status !== "complete") {
    throw new Error("FEASIBILITY_VERIFICATION_META_INVALID");
  }
  const drafts = records.map(({ candidateSetDigest, ...draft }) => {
    if (candidateSetDigest !== canonical.meta.candidateSetDigest) throw new Error("FEASIBILITY_VERIFICATION_SET_DIGEST_MISMATCH");
    return draft;
  });
  const sealed = sealFeasibilityVerification(frame, canonical, drafts, { run, usedActorIds });
  if (stableJson(sealed.records) !== stableJson(records) || sealed.meta.actorId !== meta.actorId) throw new Error("FEASIBILITY_VERIFICATION_REPLAY_MISMATCH");
  return { records, meta };
}

function validateSealedCandidate(frame, record, index, meta) {
  validateWith(frame.validators.candidate, record, `canonical candidate ${index + 1}`);
  const input = frame.input[index];
  const manifest = frame.manifests[index];
  if (record.calibrationId !== frame.contract.calibrationId || record.caseId !== input.id || record.editorActorId !== meta.editorActorId ||
      record.adjudicatorActorId !== meta.adjudicatorActorId || record.sourceDigest !== sha256(input.sourceText) ||
      record.meaningConstraintsDigest !== sha256(stableJson(input.meaningConstraints ?? []))) {
    throw new Error("FEASIBILITY_CANONICAL_BINDING_MISMATCH");
  }
  let candidate = input.sourceText;
  if (record.disposition === "edit") {
    validateCanonicalEdit(record.edit, { source: input.sourceText, manifest, editorActorId: record.editorActorId, editIds: new Set(), protectedStrings: input.protectedStrings ?? [] });
    candidate = applySingleEdit(input.sourceText, record.edit);
  } else if (record.edit !== null) {
    throw new Error("FEASIBILITY_INFEASIBLE_HAS_EDIT");
  }
  if (record.candidateDigest !== sha256(candidate) || !protectedEqual(input.sourceText, candidate, input.protectedStrings ?? [])) {
    throw new Error("FEASIBILITY_CANONICAL_CANDIDATE_DIGEST_MISMATCH");
  }
}

function validateCanonicalEdit(edit, { source, manifest, editorActorId, editIds, protectedStrings }) {
  assertExactKeys(edit, "canonical edit", ["id", "unitId", "sourceDigest", "start", "end", "replacement", "actorId"]);
  if (typeof edit.id !== "string" || edit.id.length === 0 || editIds.has(edit.id)) throw new Error("FEASIBILITY_EDIT_ID_INVALID");
  editIds.add(edit.id);
  const unit = manifest.units.find((item) => item.unitId === edit.unitId);
  if (!unit || unit.kind !== "prose" || edit.sourceDigest !== manifest.sourceDigest || edit.actorId !== editorActorId ||
      !Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < unit.start || edit.end > unit.end || edit.end < edit.start ||
      !isUtf16Boundary(source, edit.start) || !isUtf16Boundary(source, edit.end) || typeof edit.replacement !== "string" || !isMinimalEdit(source, edit)) {
    throw new Error("FEASIBILITY_EDIT_INVALID");
  }
  const candidate = applySingleEdit(source, edit);
  if (!protectedEqual(source, candidate, protectedStrings)) throw new Error("FEASIBILITY_PROTECTED_STRING_CHANGED");
}

function validateVerificationDecision(draft, disposition) {
  if (!SOURCE_DEFECTS.has(draft.sourceDefect) || !INVARIANT_DELTAS.has(draft.invariantDelta)) throw new Error("FEASIBILITY_VERIFICATION_EVIDENCE_INVALID");
  const expectedSafetyFailure = disposition === "edit" && (draft.invariantDelta !== "NONE" || SAFETY_REASON_CODES.has(draft.reasonCode));
  if (draft.safetyFailure !== expectedSafetyFailure) throw new Error("FEASIBILITY_SAFETY_FLAG_MISMATCH");
  if (disposition === "edit") {
    if (!new Set(["accept", "retain"]).has(draft.decision)) throw new Error("FEASIBILITY_EDIT_DECISION_INVALID");
    if (draft.decision === "accept") {
      if (draft.independentValidity !== "pass" || draft.safetyFailure || draft.reasonCode !== "MEANING_PRESERVED" ||
          draft.sourceDefect === "NONE" || draft.invariantDelta !== "NONE") throw new Error("FEASIBILITY_ACCEPT_CONFLICT");
    } else if (draft.independentValidity === "pass") {
      throw new Error("FEASIBILITY_RETAIN_VALIDITY_CONFLICT");
    }
  } else {
    if (!new Set(["confirm-infeasible", "dispute-infeasible"]).has(draft.decision) || draft.safetyFailure || draft.sourceDefect !== "NONE" || draft.invariantDelta !== "NONE") {
      throw new Error("FEASIBILITY_INFEASIBLE_DECISION_INVALID");
    }
    if (draft.decision === "confirm-infeasible" && (draft.independentValidity !== "pass" || draft.reasonCode !== "INFEASIBLE_CONFIRMED")) {
      throw new Error("FEASIBILITY_INFEASIBLE_CONFIRM_CONFLICT");
    }
    if (draft.decision === "dispute-infeasible" && (draft.independentValidity === "pass" || !new Set(["SAFE_EDIT_EXISTS", "UNCERTAIN"]).has(draft.reasonCode))) {
      throw new Error("FEASIBILITY_INFEASIBLE_DISPUTE_CONFLICT");
    }
  }
}

export function validateCalibrationContract(contract) {
  assertExactKeys(contract, "calibration contract", ["schemaVersion", "calibrationId", "purpose", "comparableToPriorAttempts", "executionBudget", "authorities", "thresholds", "outcomeRoutes", "forbiddenActions"]);
  assertExactKeys(contract.authorities, "calibration authorities", ["semanticSource", "meaningConstraints", "conflictDecision"]);
  assertExactKeys(contract.thresholds, "calibration thresholds", ["caseCount", "verifierCount", "unanimousEditAcceptMinimum", "safetyFailureMaximum"]);
  assertExactKeys(contract.outcomeRoutes, "calibration outcome routes", ["passed", "failed", "invalid"]);
  if (contract.schemaVersion !== "1.0.0" || contract.calibrationId !== "0.1.0-rc2-feasibility-1" ||
      contract.purpose !== "pre-freeze-feasibility-diagnostic" || contract.comparableToPriorAttempts !== false || contract.executionBudget !== 1 ||
      stableJson(contract.authorities) !== stableJson({ semanticSource: "sourceText-and-protectedStrings", meaningConstraints: "derived-conservative-check", conflictDecision: "infeasible" }) ||
      stableJson(contract.thresholds) !== stableJson({ caseCount: 11, verifierCount: 3, unanimousEditAcceptMinimum: 9, safetyFailureMaximum: 0 }) ||
      stableJson(contract.outcomeRoutes) !== stableJson({ passed: "return-to-full-fixed-diagnostic", failed: "stop-and-diagnose", invalid: "stop-and-preserve" })) {
    throw new Error("FEASIBILITY_CONTRACT_CHANGED");
  }
  const requiredForbidden = ["attempt-9", "candidate-freeze", "fresh-holdout", "suite-integration", "release", "tag", "deploy", "install", "push"];
  if (stableJson(contract.forbiddenActions) !== stableJson(requiredForbidden)) throw new Error("FEASIBILITY_FORBIDDEN_ACTIONS_CHANGED");
  return contract;
}

async function collectPriorAttemptEvidence(candidatesDirectory) {
  const entries = await readdir(candidatesDirectory, { withFileTypes: true });
  const roots = entries.filter((entry) => /^attempt-(?:3|4|5|6|7|8)(?:-|$)/u.test(entry.name));
  const files = [];
  for (const entry of roots) {
    const absolute = path.join(candidatesDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  files.sort((left, right) => left.localeCompare(right));
  const evidence = [];
  const actorIds = new Set();
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    evidence.push({ path: path.relative(candidatesDirectory, file).replaceAll(path.sep, "/"), sha256: sha256(contents) });
    for (const actorId of contents.match(ACTOR_ID_IN_TEXT) ?? []) actorIds.add(actorId);
  }
  return { digest: sha256(stableJson(evidence)), actorIds: [...actorIds].sort(), files: evidence };
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function calibrationRelative(file) {
  return `evals/cycles/0.1.0-rc2/diagnostic/semantic-regression/feasibility-calibration/${file}`;
}

function candidateRelative(file) {
  return `evals/cycles/0.1.0-rc2/diagnostic/semantic-regression/new-candidates/${file}`;
}

function validateWith(validator, value, label) {
  if (!validator(value)) throw new Error(`${label} schema invalid: ${JSON.stringify(validator.errors)}`);
}

function requireActor(value, label) {
  if (typeof value !== "string" || !ACTOR_ID.test(value)) throw new Error(`${label} invalid`);
}

function requireChildPath(parent, target, label) {
  if (target === parent || !target.startsWith(`${parent}${path.sep}`)) throw new Error(`${label} must be below calibration directory`);
}

function assertExactKeys(value, label, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} fields mismatch`);
}

function applySingleEdit(source, edit) {
  return `${source.slice(0, edit.start)}${edit.replacement}${source.slice(edit.end)}`;
}

function isMinimalEdit(source, edit) {
  const original = source.slice(edit.start, edit.end);
  if (original === edit.replacement) return false;
  if (original.length === 0 || edit.replacement.length === 0) return true;
  const originalCodePoints = Array.from(original);
  const replacementCodePoints = Array.from(edit.replacement);
  return originalCodePoints[0] !== replacementCodePoints[0] && originalCodePoints.at(-1) !== replacementCodePoints.at(-1);
}

function isUtf16Boundary(source, index) {
  if (index <= 0 || index >= source.length) return true;
  const before = source.charCodeAt(index - 1);
  const after = source.charCodeAt(index);
  return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF);
}

function protectedEqual(source, candidate, protectedStrings) {
  return protectedStrings.every((value) => count(source, value) === count(candidate, value)) &&
    orderedProtected(source, protectedStrings) === orderedProtected(candidate, protectedStrings);
}

function orderedProtected(text, values) {
  return values.filter((value) => text.includes(value)).map((value) => [value, text.indexOf(value)]).sort((left, right) => left[1] - right[1]).map(([value]) => value).join("\u0000");
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

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
