import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCalibrationFreeze,
  buildFeasibilityResult,
  loadCalibrationFrame,
  sealCanonicalCandidates,
  sealFeasibilityVerification,
  writeDirectoryAtomically,
  writeNewFileAtomically,
} from "../scripts/lib/feasibility-calibration.mjs";
import { sha256, workProductDigest } from "../scripts/lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cycleDirectory = "evals/cycles/0.1.0-rc2";
const actors = {
  editor: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  adjudicator: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  verifiers: [
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  ],
};

test("feasibility frame freezes a separate one-time non-release diagnostic", async () => {
  const frame = await loadCalibrationFrame({ repositoryRoot: root, cycleDirectory });
  const freeze = buildCalibrationFreeze(frame);
  assert.equal(frame.input.length, 11);
  assert.equal(freeze.purpose, "pre-freeze-feasibility-diagnostic");
  assert.equal(freeze.comparableToPriorAttempts, false);
  assert.equal(freeze.executionBudget, 1);
  assert.match(freeze.requestArtifactDigest, /^[a-f0-9]{64}$/u);
  assert.match(freeze.frameDigest, /^[a-f0-9]{64}$/u);
  assert.ok(frame.prior.actorIds.length > 0);
  assert.equal(frame.contract.forbiddenActions.includes("attempt-9"), true);
  assert.equal(frame.contract.forbiddenActions.includes("fresh-holdout"), true);
});

test("canonical candidates bind one edit or infeasible to source and per-case digest", async () => {
  const { frame, canonical } = await makeCanonical();
  assert.equal(canonical.meta.caseCount, 11);
  assert.equal(canonical.meta.editCount, 9);
  assert.equal(canonical.records.filter((item) => item.disposition === "infeasible").length, 2);
  for (let index = 0; index < canonical.records.length; index += 1) {
    const record = canonical.records[index];
    assert.equal(record.sourceDigest, sha256(frame.input[index].sourceText));
    assert.match(record.candidateDigest, /^[a-f0-9]{64}$/u);
    if (record.disposition === "edit") assert.notEqual(record.candidateDigest, record.sourceDigest);
    else assert.equal(record.candidateDigest, record.sourceDigest);
  }

  const drafts = makeCandidateDrafts(frame);
  drafts[0] = { ...drafts[0], edit: { ...drafts[0].edit, sourceDigest: sha256("wrong") } };
  assert.throws(() => sealCanonicalCandidates(frame, drafts), /FEASIBILITY_EDIT_INVALID/u);
});

test("three fresh verifiers evaluate the identical sealed candidates", async () => {
  const { frame, canonical } = await makeCanonical();
  const runs = [];
  for (let run = 1; run <= 3; run += 1) {
    const drafts = makeVerificationDrafts(canonical, actors.verifiers[run - 1]);
    runs.push(sealFeasibilityVerification(frame, canonical, drafts, { run, usedActorIds: runs.map((item) => item.meta.actorId) }));
  }
  const result = buildFeasibilityResult(frame, canonical, runs);
  assert.equal(result.status, "passed-feasibility");
  assert.equal(result.releaseDecision, "not-evaluated");
  assert.equal(result.comparableToPriorAttempts, false);
  assert.deepEqual(result.counts, { cases: 11, canonicalEdits: 9, infeasible: 2, unanimousEditAccept: 9, safetyFailures: 0 });
  assert.equal(result.nextStep, "return-to-full-fixed-diagnostic");

  const reused = makeVerificationDrafts(canonical, actors.verifiers[0]);
  assert.throws(() => sealFeasibilityVerification(frame, canonical, reused, { run: 2, usedActorIds: [actors.verifiers[0]] }), /FEASIBILITY_VERIFIER_ACTOR_REUSE/u);
  const mismatched = makeVerificationDrafts(canonical, actors.verifiers[1]);
  mismatched[0] = { ...mismatched[0], candidateDigest: sha256("different") };
  assert.throws(() => sealFeasibilityVerification(frame, canonical, mismatched, { run: 2 }), /FEASIBILITY_VERIFICATION_BINDING_MISMATCH/u);
  const contradictory = makeVerificationDrafts(canonical, actors.verifiers[1]);
  contradictory[0] = { ...contradictory[0], independentValidity: "fail" };
  assert.throws(() => sealFeasibilityVerification(frame, canonical, contradictory, { run: 2 }), /FEASIBILITY_ACCEPT_CONFLICT/u);
});

test("one verifier rejection keeps the feasibility result failed without changing safety", async () => {
  const { frame, canonical } = await makeCanonical();
  const runs = [];
  for (let run = 1; run <= 3; run += 1) {
    const drafts = makeVerificationDrafts(canonical, actors.verifiers[run - 1]);
    if (run === 3) drafts[0] = {
      ...drafts[0],
      independentValidity: "fail",
      decision: "retain",
      reasonCode: "NO_CLEAR_IMPROVEMENT",
      sourceDefect: "NONE",
    };
    runs.push(sealFeasibilityVerification(frame, canonical, drafts, { run, usedActorIds: runs.map((item) => item.meta.actorId) }));
  }
  const result = buildFeasibilityResult(frame, canonical, runs);
  assert.equal(result.status, "failed-feasibility");
  assert.equal(result.counts.unanimousEditAccept, 8);
  assert.equal(result.counts.safetyFailures, 0);
  assert.equal(result.nextStep, "stop-and-diagnose");
});

test("sealed calibration evidence preserves the one-time failed-feasibility verdict", async () => {
  const calibrationDirectory = path.join(
    root,
    cycleDirectory,
    "diagnostic/semantic-regression/feasibility-calibration",
  );
  const result = JSON.parse(await readFile(path.join(calibrationDirectory, "final-results.json"), "utf8"));
  const canonicalMeta = JSON.parse(await readFile(path.join(calibrationDirectory, "canonical/meta.json"), "utf8"));
  const verificationMeta = await Promise.all([1, 2, 3].map(async (run) => JSON.parse(await readFile(
    path.join(calibrationDirectory, `runs/run-${run}/meta.json`),
    "utf8",
  ))));

  assert.equal(result.status, "failed-feasibility");
  assert.equal(result.executionCount, 1);
  assert.equal(result.executionBudget, 1);
  assert.equal(result.comparableToPriorAttempts, false);
  assert.equal(result.releaseDecision, "not-evaluated");
  assert.equal(result.nextStep, "stop-and-diagnose");
  assert.deepEqual(result.counts, {
    cases: 11,
    canonicalEdits: 7,
    infeasible: 4,
    unanimousEditAccept: 7,
    safetyFailures: 0,
  });
  assert.equal(result.candidateSetDigest, canonicalMeta.candidateSetDigest);
  assert.equal(new Set(result.actorIds.verifiers).size, 3);
  assert.equal(new Set([
    result.actorIds.editor,
    result.actorIds.adjudicator,
    ...result.actorIds.verifiers,
  ]).size, 5);
  for (const meta of verificationMeta) {
    assert.equal(meta.candidateSetDigest, result.candidateSetDigest);
    assert.equal(meta.freezeDigest, result.freezeDigest);
  }
});

test("atomic evidence writers publish complete outputs once", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kpe-feasibility-"));
  try {
    const file = path.join(directory, "result.json");
    await writeNewFileAtomically(file, "{\"complete\":true}\n");
    assert.equal(await readFile(file, "utf8"), "{\"complete\":true}\n");
    await assert.rejects(() => writeNewFileAtomically(file, "replacement\n"), /REFUSE_OVERWRITE/u);

    const evidence = path.join(directory, "run-1");
    await writeDirectoryAtomically(evidence, { "work.jsonl": "{}\n", "meta.json": "{}\n" });
    assert.equal(await readFile(path.join(evidence, "work.jsonl"), "utf8"), "{}\n");
    assert.equal(await readFile(path.join(evidence, "meta.json"), "utf8"), "{}\n");
    await assert.rejects(() => writeDirectoryAtomically(evidence, { "work.jsonl": "changed\n" }), /REFUSE_OVERWRITE/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function makeCanonical() {
  const loaded = await loadCalibrationFrame({ repositoryRoot: root, cycleDirectory });
  const frame = { ...loaded, freezeDigest: "f".repeat(64) };
  const canonical = sealCanonicalCandidates(frame, makeCandidateDrafts(frame));
  return { frame, canonical };
}

function makeCandidateDrafts(frame) {
  return frame.input.map((item, index) => {
    const edit = index < 9;
    return {
      schemaVersion: "1.0.0",
      calibrationId: frame.contract.calibrationId,
      caseId: item.id,
      editorActorId: actors.editor,
      adjudicatorActorId: actors.adjudicator,
      disposition: edit ? "edit" : "infeasible",
      rationaleCode: edit ? "SAFE_MINIMAL_EDIT" : "NO_SAFE_CLEAR_IMPROVEMENT",
      edit: edit ? {
        id: `calibration-edit-${String(index + 1).padStart(2, "0")}`,
        unitId: "unit-0001",
        sourceDigest: sha256(item.sourceText),
        start: item.sourceText.length - 1,
        end: item.sourceText.length,
        replacement: "!",
        actorId: actors.editor,
      } : null,
    };
  });
}

function makeVerificationDrafts(canonical, actorId) {
  return canonical.records.map((candidate) => ({
    schemaVersion: "1.0.0",
    calibrationId: candidate.calibrationId,
    actorId,
    caseId: candidate.caseId,
    canonicalCandidateDigest: workProductDigest(candidate),
    candidateDigest: candidate.candidateDigest,
    independentValidity: "pass",
    safetyFailure: false,
    decision: candidate.disposition === "edit" ? "accept" : "confirm-infeasible",
    reasonCode: candidate.disposition === "edit" ? "MEANING_PRESERVED" : "INFEASIBLE_CONFIRMED",
    sourceDefect: candidate.disposition === "edit" ? "TRANSLATIONESE" : "NONE",
    invariantDelta: "NONE",
  }));
}
