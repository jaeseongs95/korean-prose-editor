import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  aggregateStructuredRun,
  buildRunMetadata,
  evaluateStructuredCase,
  parseJsonl,
  sealEditingDraft,
  sha256,
  stableJson,
  validateEditingWorkProduct,
  validateRunMetadata,
  workProductDigest,
  writeNewFile,
} from "../scripts/lib/evaluation-cycle.mjs";
import { prepareEvaluationCycle, validateFreshHoldout } from "../scripts/prepare-evaluation-cycle.mjs";
import { summarizeEvaluationCycle } from "../scripts/summarize-evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cycleDir = path.join(root, "evals", "cycles", "0.1.0-rc2");
const actorIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

test("cycle work-product schemas compile and enforce the approved field contract", async () => {
  const ajv = new Ajv2020({ strict: true });
  for (const name of ["source-unit-manifest", "selection-work-product", "editing-draft", "editing-work-product", "verification-work-product", "fresh-holdout"]) {
    const schemaFile = name === "fresh-holdout"
      ? path.join(cycleDir, "schemas", `${name}.schema.json`)
      : path.join(root, "skills", "korean-prose-editor", "contracts", `${name}.v1.schema.json`);
    const schema = JSON.parse(await readFile(schemaFile, "utf8"));
    assert.equal(typeof ajv.compile(schema), "function");
  }
  const runMeta = JSON.parse(await readFile(path.join(cycleDir, "schemas", "run-meta.schema.json"), "utf8"));
  assert.equal(typeof ajv.compile(runMeta), "function");
});

test("structured edits, not candidateText diffs, determine candidate and final text", () => {
  const sourceText = "안녕 하세요.";
  const rubricDigest = sha256("rubric");
  const manifest = sourceManifest(sourceText);
  const selection = selectionProduct(sourceText, "edit");
  const edit = {
    id: "edit-1",
    unitId: "unit-0001",
    sourceDigest: manifest.sourceDigest,
    start: 2,
    end: 3,
    replacement: "",
    actorId: actorIds[1],
  };
  const editing = editingProduct(sourceText, selection, [edit]);
  const verification = verificationProduct(manifest.sourceDigest, editing, rubricDigest, [{ editId: "edit-1", decision: "accept", reasonCode: "MEANING_PRESERVED" }]);
  const result = evaluateStructuredCase({
    input: { id: "legacy:T001", suite: "legacy-100", sourceText, protectedStrings: [] },
    expectedDecision: "edit",
    manifest,
    selection,
    editing,
    verification,
    rubricDigest,
  });
  assert.equal(result.candidateText, "안녕하세요.");
  assert.equal(result.finalText, "안녕하세요.");
  assert.deepEqual(result.editResults, [{ editId: "edit-1", unitId: "unit-0001", decision: "accept", reasonCode: "MEANING_PRESERVED" }]);
  assert.equal(Object.hasOwn(editing, "candidateText"), false);

  assert.throws(() => evaluateStructuredCase({
    input: { id: "legacy:T001", suite: "legacy-100", sourceText, protectedStrings: [] },
    expectedDecision: "edit",
    manifest,
    selection,
    editing: { ...editing, candidateDigest: sha256("unbound candidate") },
    verification,
    rubricDigest,
  }), /EDITING_CANDIDATE_DIGEST_MISMATCH/u);
});

test("editing drafts are deterministically sealed with per-record digests", () => {
  const sourceText = "안녕 하세요.";
  const selection = selectionProduct(sourceText, "edit");
  const draft = {
    schemaVersion: "1.0.0",
    actorId: actorIds[1],
    sourceDigest: sha256(sourceText),
    edits: [{
      id: "edit-1",
      unitId: "unit-0001",
      sourceDigest: sha256(sourceText),
      start: 2,
      end: 3,
      replacement: "",
      actorId: actorIds[1],
    }],
  };
  const sealed = sealEditingDraft(draft, { source: sourceText, selection });
  assert.equal(sealed.selectionDigest, workProductDigest(selection));
  assert.equal(sealed.candidateDigest, sha256("안녕하세요."));
  assert.equal(Object.hasOwn(sealed, "candidateText"), false);
  assert.throws(() => sealEditingDraft({ ...draft, sourceDigest: sha256("다른 원문") }, { source: sourceText, selection }), /EDITING_DRAFT_SOURCE_DIGEST_MISMATCH/u);
  assert.throws(() => sealEditingDraft({ ...draft, unexpected: true }, { source: sourceText, selection }), /editing-draft fields/u);
  const nonMinimal = {
    ...draft,
    edits: [{ ...draft.edits[0], start: 0, end: 3, replacement: "안녕" }],
  };
  assert.throws(() => sealEditingDraft(nonMinimal, { source: sourceText, selection }), /EDIT_NOT_MINIMAL/u);
});

test("editing drafts reject a newly introduced boundary whitespace artifact", () => {
  const sourceText = "먼저 안내 말씀을 드리자면, 정기 점검 중에는 출입문을 수동으로 열어야 합니다.";
  const selection = selectionProduct(sourceText, "edit");
  selection.decisions[0].issueRanges = [{ start: 0, end: 15, reasonCode: "UNNECESSARY_META_PROSE" }];
  selection.decisions[0].reasonCodes = ["UNNECESSARY_META_PROSE"];
  const draft = {
    schemaVersion: "1.0.0",
    actorId: actorIds[1],
    sourceDigest: sha256(sourceText),
    edits: [{
      id: "edit-1",
      unitId: "unit-0001",
      sourceDigest: sha256(sourceText),
      start: 0,
      end: 15,
      replacement: "",
      actorId: actorIds[1],
    }],
  };
  assert.throws(() => sealEditingDraft(draft, { source: sourceText, selection }), /EDITING_BOUNDARY_WHITESPACE_ARTIFACT/u);
  const manifest = sourceManifest(sourceText);
  const unsafeWorkProduct = editingProduct(sourceText, selection, draft.edits);
  assert.throws(() => validateEditingWorkProduct(unsafeWorkProduct, { source: sourceText, manifest, selection }), /EDITING_BOUNDARY_WHITESPACE_ARTIFACT/u);
  const safe = sealEditingDraft({ ...draft, edits: [{ ...draft.edits[0], end: 16 }] }, { source: sourceText, selection });
  assert.equal(safe.candidateDigest, sha256("정기 점검 중에는 출입문을 수동으로 열어야 합니다."));
});

test("editing recorder leaves no work product when draft validation fails", async () => {
  const temporaryCycle = await mkdtemp(path.join(root, "evals", "cycles", "recorder-failure-"));
  const suiteDirectory = path.join(temporaryCycle, "diagnostic", "test-suite");
  const runDirectory = path.join(suiteDirectory, "runs", "run-1");
  try {
    await mkdir(runDirectory, { recursive: true });
    const sourceText = "안녕 하세요.";
    const manifest = sourceManifest(sourceText);
    const selection = selectionProduct(sourceText, "edit");
    const draft = {
      schemaVersion: "1.0.0",
      actorId: actorIds[1],
      sourceDigest: sha256(sourceText),
      edits: [{
        id: "edit-1", unitId: "unit-0001", sourceDigest: sha256("잘못된 원문"),
        start: 2, end: 3, replacement: "", actorId: actorIds[1],
      }],
    };
    await Promise.all([
      writeFile(path.join(suiteDirectory, "input.jsonl"), `${JSON.stringify({ id: "case-1", sourceText })}\n`, "utf8"),
      writeFile(path.join(suiteDirectory, "source-unit-manifest.jsonl"), `${JSON.stringify(manifest)}\n`, "utf8"),
      writeFile(path.join(runDirectory, "selection-work-product.jsonl"), `${JSON.stringify(selection)}\n`, "utf8"),
      writeFile(path.join(runDirectory, "editing-draft.jsonl"), `${JSON.stringify(draft)}\n`, "utf8"),
    ]);
    const cycleArgument = path.relative(root, temporaryCycle).replaceAll(path.sep, "/");
    const result = spawnSync(process.execPath, [
      "scripts/record-editing-run.mjs", "--cycle-dir", cycleArgument,
      "--suite-dir", "test-suite", "--run", "1",
    ], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EDIT_SOURCE_DIGEST_MISMATCH/u);
    await assert.rejects(readFile(path.join(runDirectory, "editing-work-product.jsonl"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(temporaryCycle, { recursive: true, force: true });
  }
});

test("selection recorder writes provenance-bound v3 metadata for a new run", async () => {
  const temporaryCycle = await mkdtemp(path.join(root, "evals", "cycles", "recorder-provenance-"));
  const suiteDirectory = path.join(temporaryCycle, "diagnostic", "test-suite");
  const runDirectory = path.join(suiteDirectory, "runs", "run-1");
  try {
    await mkdir(runDirectory, { recursive: true });
    const sourceText = "안녕 하세요.";
    const manifest = sourceManifest(sourceText);
    const selection = selectionProduct(sourceText, "edit");
    const provenance = {
      requestedModel: "gpt-5.6-sol",
      actualModel: "unverified",
      provider: "openai",
      providerVersion: "unverified",
      promptSha256: sha256("selection prompt"),
      seed: "unverified",
      decodingParametersSha256: "unverified",
    };
    await Promise.all([
      writeFile(path.join(suiteDirectory, "input.jsonl"), `${JSON.stringify({ id: "case-1", sourceText })}\n`, "utf8"),
      writeFile(path.join(suiteDirectory, "source-unit-manifest.jsonl"), `${JSON.stringify(manifest)}\n`, "utf8"),
      writeFile(path.join(runDirectory, "selection-work-product.jsonl"), `${JSON.stringify(selection)}\n`, "utf8"),
      writeFile(path.join(runDirectory, "selection-provenance.json"), `${JSON.stringify(provenance)}\n`, "utf8"),
    ]);
    const cycleArgument = path.relative(root, temporaryCycle).replaceAll(path.sep, "/");
    const provenanceArgument = path.relative(temporaryCycle, path.join(runDirectory, "selection-provenance.json")).replaceAll(path.sep, "/");
    const result = spawnSync(process.execPath, [
      "scripts/record-selection-run.mjs", "--cycle-dir", cycleArgument,
      "--suite-dir", "test-suite", "--run", "1", "--provenance-file", provenanceArgument,
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const meta = JSON.parse(await readFile(path.join(runDirectory, "selection-meta.json"), "utf8"));
    assert.equal(meta.schemaVersion, "3.0.0");
    assert.deepEqual(meta.executionProvenance, provenance);
  } finally {
    await rm(temporaryCycle, { recursive: true, force: true });
  }
});

test("diagnostic inventory fixes 18 expected edits, 20 controls, and 15/18 plus 18/20 gates", async () => {
  const inventory = JSON.parse(await readFile(path.join(cycleDir, "diagnostic", "inventory.json"), "utf8"));
  assert.equal(inventory.editCases.length, 18);
  assert.equal(inventory.controlCases.length, 20);
  assert.deepEqual(inventory.thresholds, {
    editRecallMinimum: 15,
    editRecallDenominator: 18,
    restraintMinimum: 18,
    restraintDenominator: 20,
  });
  assert.deepEqual(inventory.editCases.slice(-3).map((item) => [item.sourceId, item.caseId]), [
    ["P04", "holdout:H026"],
    ["P07", "holdout:H029"],
    ["P08", "holdout:H030"],
  ]);
  assert.equal(inventory.regressionCases.length, 1);
  assert.deepEqual(inventory.regressionCases[0].protectedStrings, ["v1.0.5", "10개", "v1.1.0", "finalization", "digest", "SQLite"]);
  assert.deepEqual(inventory.regressionCases[0].thresholds, { protectedExactRate: 100, pairPreference: "candidate" });
  const preparedInput = parseJsonl(await readFile(path.join(cycleDir, "diagnostic", "input.jsonl"), "utf8"));
  const preparedKey = JSON.parse(await readFile(path.join(cycleDir, "diagnostic", "key.json"), "utf8"));
  const preparedManifest = JSON.parse(await readFile(path.join(cycleDir, "diagnostic", "manifest.json"), "utf8"));
  assert.deepEqual(preparedManifest.fixedDiagnosticCounts, { edit: 18, control: 20, userFacingJargon: 1 });
  assert.equal(preparedInput.length, 39);
  assert.equal(preparedKey.length, 39);
  assert.equal(preparedInput.at(-1).id, "regression:user-facing-jargon-001");

  const prepareAgain = spawnSync(process.execPath, ["scripts/prepare-known-diagnostic.mjs", "--cycle-dir", "evals/cycles/0.1.0-rc2"], { cwd: root, encoding: "utf8" });
  assert.notEqual(prepareAgain.status, 0);
  assert.match(prepareAgain.stderr, /REFUSE_OVERWRITE/u);

  const cases = [...inventory.editCases, ...inventory.controlCases].map((item) => ({
    id: item.caseId,
    suite: item.origin === "legacy" ? "legacy-100" : "holdout-30",
    sourceText: "문장입니다.",
    protectedStrings: [],
  }));
  const products = cases.map((item, index) => makeCaseProducts(item.sourceText, index < 15 || index >= 18 && index < 20));
  const thresholds = releaseThresholds();
  const { metrics } = aggregateStructuredRun({
    run: 1,
    input: cases,
    key: cases.map((item, index) => ({ id: item.id, expectedDecision: index < 18 ? "edit" : "retain" })),
    manifests: products.map((item) => item.manifest),
    selections: products.map((item) => item.selection),
    editings: products.map((item) => item.editing),
    verifications: products.map((item) => item.verification),
    rubricDigest: sha256("rubric"),
    thresholds,
    diagnosticInventory: inventory,
  });
  assert.deepEqual(metrics.diagnostic, {
    editRecallCount: 15,
    editRecallDenominator: 18,
    restraintCount: 18,
    restraintDenominator: 20,
    userFacingJargon: null,
  });
  assert.equal(metrics.gate.diagnosticPass, true);
  assert.throws(() => aggregateStructuredRun({
    run: 4,
    input: [], key: [], manifests: [], selections: [], editings: [], verifications: [],
    rubricDigest: sha256("rubric"), thresholds,
  }), /RUN_OUTSIDE_FROZEN_BUDGET/u);
});

test("negative semantic-drift fixture contains exactly the 13 historical rejected changed edit candidates", async () => {
  const records = parseJsonl(await readFile(path.join(cycleDir, "diagnostic", "semantic-drift-regressions.jsonl"), "utf8"));
  assert.equal(records.length, 13);
  assert.deepEqual(records.map((item) => `${item.run}:${item.caseId}`), [
    "1:legacy:T019", "1:legacy:T071", "1:legacy:T098",
    "2:legacy:T019", "2:legacy:T083", "2:legacy:T086", "2:legacy:T087", "2:legacy:T099",
    "3:legacy:T019", "3:legacy:T025", "3:legacy:T038", "3:legacy:T049", "3:legacy:T050",
  ]);
  assert.ok(records.every((item) => item.sourceDigest !== item.candidateDigest && item.verifierEvidence.finalDecision !== "accept"));

  const result = spawnSync(process.execPath, ["scripts/extract-semantic-drift-regressions.mjs", "--output", "evals/cycles/0.1.0-rc2/diagnostic/semantic-drift-regressions.jsonl"], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /REFUSE_OVERWRITE/u);
});

test("prepared semantic regressions expose structured edits without leaking the historical verdict", async () => {
  const directory = path.join(cycleDir, "diagnostic", "semantic-regression");
  const input = parseJsonl(await readFile(path.join(directory, "input.jsonl"), "utf8"));
  const key = JSON.parse(await readFile(path.join(directory, "key.json"), "utf8"));
  assert.equal(input.length, 13);
  assert.equal(key.length, 13);
  assert.ok(input.every((item) => item.edit && !Object.hasOwn(item, "expectedDecision") && !Object.hasOwn(item, "historicalVerifierEvidence")));
  assert.ok(input.every((item) => {
    const candidate = `${item.sourceText.slice(0, item.edit.start)}${item.edit.replacement}${item.sourceText.slice(item.edit.end)}`;
    return sha256(candidate) === item.edit.candidateDigest;
  }));
  assert.ok(key.every((item) => item.expectedDecision === "retain" && item.historicalVerifierEvidence));
});

test("user-facing abstraction diagnostic is a semantic contrast, not a receipt keyword list", async () => {
  const directory = path.join(cycleDir, "diagnostic", "user-facing-abstraction");
  const input = parseJsonl(await readFile(path.join(directory, "input.jsonl"), "utf8"));
  const key = JSON.parse(await readFile(path.join(directory, "key.json"), "utf8"));
  const results = JSON.parse(await readFile(path.join(directory, "results.json"), "utf8"));
  assert.equal(input.length, 10);
  assert.deepEqual(key.map((item) => item.expectedDecision), ["edit", "edit", "edit", "edit", "edit", "retain", "retain", "retain", "retain", "retain"]);
  assert.ok(input.some((item) => item.id.startsWith("UFA-E") && !item.sourceText.includes("영수증")));
  assert.ok(input.some((item) => item.id.startsWith("UFA-R") && item.sourceText.includes("영수증")));
  assert.ok(input.some((item) => item.id.startsWith("UFA-R") && item.sourceText.includes("digest")));
  assert.equal(results.status, "pass");
  assert.ok(results.runs.every((run) => run.expectedActionMatch === "10/10" && run.contractValidation === "pass"));
});

test("new semantic candidates pass the third independent selection attempt", async () => {
  const directory = path.join(cycleDir, "diagnostic", "semantic-regression", "new-candidates");
  const input = parseJsonl(await readFile(path.join(directory, "input.jsonl"), "utf8"));
  const results = JSON.parse(await readFile(path.join(directory, "attempt-3-results.json"), "utf8"));
  assert.equal(input.length, 11);
  assert.equal(results.status, "passed-selection");
  assert.equal(results.actorsDistinct, true);
  assert.equal(results.runs.length, 3);
  assert.equal(new Set(results.runs.map((run) => run.selectionActorId)).size, 3);
  assert.ok(results.runs.every((run) => run.pass && run.selectedEditCases === "11/11"));
});

test("failed third editing attempt preserves complete independent verification evidence", async () => {
  const directory = path.join(cycleDir, "diagnostic", "semantic-regression", "new-candidates");
  const results = JSON.parse(await readFile(path.join(directory, "attempt-3-final-results.json"), "utf8"));
  assert.equal(results.status, "failed-final");
  assert.equal(results.globalActorsDistinct, true);
  assert.equal(results.runs.length, 3);
  assert.equal(new Set(results.runs.flatMap((run) => Object.values(run.actorIds))).size, 9);
  assert.ok(results.runs.every((run) => run.majorMeaningChangeCount === 0 && run.protectedFailureCount === 0));
  assert.ok(results.runs.every((run) => !run.pass));
});

test("fourth editing attempt preserves two passing runs and one failed run", async () => {
  const directory = path.join(cycleDir, "diagnostic", "semantic-regression", "new-candidates");
  const results = JSON.parse(await readFile(path.join(directory, "attempt-4-final-results.json"), "utf8"));
  assert.equal(results.status, "failed-final");
  assert.equal(results.globalActorsDistinct, true);
  assert.deepEqual(results.runs.map((run) => run.improvedCases), ["9/11", "9/11", "6/11"]);
  assert.deepEqual(results.runs.map((run) => run.pass), [true, true, false]);
  assert.ok(results.runs.every((run) => run.majorMeaningChangeCount === 0 && run.protectedFailureCount === 0));
});

test("sixth editing attempt preserves carried selection provenance and final evidence", async () => {
  const directory = path.join(cycleDir, "diagnostic", "semantic-regression", "new-candidates");
  const provenance = JSON.parse(await readFile(path.join(directory, "attempt-6-selection-provenance.json"), "utf8"));
  const results = JSON.parse(await readFile(path.join(directory, "attempt-6-final-results.json"), "utf8"));
  assert.equal(provenance.sourceAttempt, 5);
  assert.equal(provenance.files.length, 6);
  assert.equal(results.status, "failed-final");
  assert.equal(results.globalActorsDistinct, true);
  assert.deepEqual(results.runs.map((run) => run.improvedCases), ["8/11", "10/11", "8/11"]);
  assert.ok(results.runs.every((run) => run.majorMeaningChangeCount === 0 && run.protectedFailureCount === 0));
});

test("seventh verification attempt preserves carried artifacts and independent-edit evidence", async () => {
  const directory = path.join(cycleDir, "diagnostic", "semantic-regression", "new-candidates");
  const provenance = JSON.parse(await readFile(path.join(directory, "attempt-7-provenance.json"), "utf8"));
  const results = JSON.parse(await readFile(path.join(directory, "attempt-7-final-results.json"), "utf8"));
  assert.equal(provenance.sourceAttempt, 6);
  assert.equal(provenance.files.length, 12);
  assert.equal(results.status, "failed-final");
  assert.equal(results.globalActorsDistinct, true);
  assert.deepEqual(results.runs.map((run) => run.improvedCases), ["5/11", "7/11", "7/11"]);
  assert.ok(results.runs.every((run) => run.majorMeaningChangeCount === 0 && run.protectedFailureCount === 0));
});

test("fresh holdout requires 30 unique cases balanced 10/10/10", () => {
  const holdout = Array.from({ length: 30 }, (_, index) => ({
    id: `private-${index + 1}`,
    genre: "test",
    context: null,
    sourceText: `원문 ${index + 1}`,
    userRequest: "다듬어 주세요.",
    register: "preserve",
    meaningConstraints: [],
    protectedStrings: [],
    expectedDecision: ["edit", "retain", "defer"][index % 3],
  }));
  assert.doesNotThrow(() => validateFreshHoldout(holdout));
  assert.throws(() => validateFreshHoldout(holdout.slice(1)), /FRESH_HOLDOUT_MUST_HAVE_30_CASES/u);
  assert.throws(() => validateFreshHoldout(holdout.map((item) => ({ ...item, expectedDecision: "edit" }))), /FRESH_HOLDOUT_MUST_BALANCE_10_10_10/u);
});

test("cycle preparation freezes every binding and refuses to overwrite generated evidence", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kpe-cycle-"));
  try {
    await seedPreparationRepository(temporaryRoot);
    const result = await prepareEvaluationCycle({
      repositoryRoot: temporaryRoot,
      cycleDir: "evals/cycles/test-cycle",
      candidateCommit: "a".repeat(40),
      holdoutFile: "evals/cycles/test-cycle/holdout/cases.json",
    });
    assert.deepEqual({ caseCount: result.caseCount, runCount: result.runCount }, { caseCount: 130, runCount: 3 });
    const freeze = JSON.parse(await readFile(path.join(temporaryRoot, "evals", "cycles", "test-cycle", "FREEZE.json"), "utf8"));
    assert.deepEqual(Object.keys(freeze.bindings).sort(), ["candidateCommit", "corpus", "holdout", "policies", "privateSchemas", "protocol", "thresholds"]);
    await assert.rejects(() => prepareEvaluationCycle({
      repositoryRoot: temporaryRoot,
      cycleDir: "evals/cycles/test-cycle",
      candidateCommit: "a".repeat(40),
      holdoutFile: "evals/cycles/test-cycle/holdout/cases.json",
    }), /REFUSE_OVERWRITE/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("writeNewFile never overwrites existing evidence", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kpe-no-overwrite-"));
  const file = path.join(temporaryRoot, "evidence.json");
  try {
    await writeFile(file, "old\n", "utf8");
    await assert.rejects(() => writeNewFile(file, "new\n"), /REFUSE_OVERWRITE/u);
    assert.equal(await readFile(file, "utf8"), "old\n");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("run metadata binds actor, count, input digest, and canonical work-product digest", () => {
  const products = {
    selection: [{ actorId: actorIds[0], value: "selection" }],
    editing: [{ actorId: actorIds[1], value: "editing" }],
    verification: [{ actorId: actorIds[2], value: "verification" }],
  };
  const inputSha256 = sha256("input bytes");
  const metas = Object.fromEntries(Object.entries(products).map(([role, records]) => [role, {
    schemaVersion: "2.0.0",
    run: 1,
    role,
    actorId: records[0].actorId,
    caseCount: records.length,
    inputSha256,
    workProductSha256: sha256(stableJson(records)),
    status: "complete",
  }]));
  assert.doesNotThrow(() => validateRunMetadata({ run: 1, inputSha256, products, metas }));
  assert.throws(() => validateRunMetadata({ run: 1, inputSha256, products, metas, requireExecutionProvenance: true }), /ROLE_META_EXECUTION_PROVENANCE_REQUIRED/u);
  const executionProvenance = {
    requestedModel: "gpt-5.6-sol",
    actualModel: "unverified",
    provider: "openai",
    providerVersion: "unverified",
    promptSha256: sha256("role prompt"),
    seed: "unverified",
    decodingParametersSha256: "unverified",
  };
  const provenanceMetas = Object.fromEntries(Object.entries(products).map(([role, records]) => [role, buildRunMetadata({
    run: 1,
    role,
    actorId: records[0].actorId,
    records,
    inputSha256,
    executionProvenance,
  })]));
  assert.doesNotThrow(() => validateRunMetadata({ run: 1, inputSha256, products, metas: provenanceMetas, requireExecutionProvenance: true }));
  assert.throws(() => buildRunMetadata({
    run: 1,
    role: "editing",
    actorId: actorIds[1],
    records: products.editing,
    inputSha256,
    executionProvenance: { ...executionProvenance, actualModel: "" },
  }), /EXECUTION_PROVENANCE_ACTUALMODEL_INVALID/u);
  assert.throws(() => validateRunMetadata({
    run: 1,
    inputSha256,
    products,
    metas: { ...metas, editing: { ...metas.editing, workProductSha256: sha256("wrong") } },
  }), /ROLE_META_OUTPUT_DIGEST_MISMATCH:editing/u);
});

test("cycle summary requires exactly three runs and nine globally unique actors", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kpe-summary-"));
  try {
    const candidateCommit = "b".repeat(40);
    await mkdir(path.join(temporaryRoot, "runs"), { recursive: true });
    await writeFile(path.join(temporaryRoot, "manifest.json"), `${JSON.stringify({ cycleId: "test", candidateCommit, runCount: 3 })}\n`, "utf8");
    for (let run = 1; run <= 3; run += 1) {
      const runDir = path.join(temporaryRoot, "runs", `run-${run}`);
      await mkdir(runDir, { recursive: true });
      const ids = [1, 2, 3].map((role) => actorIdFor((run - 1) * 3 + role));
      await writeFile(path.join(runDir, "metrics.json"), `${JSON.stringify({ run, candidateCommit, actorIds: ids, gate: { releasePass: true, diagnosticPass: true } })}\n`, "utf8");
      for (const [index, role] of ["selection", "editing", "verification"].entries()) {
        await writeFile(path.join(runDir, `${role}-meta.json`), `${JSON.stringify({ run, role, actorId: ids[index] })}\n`, "utf8");
      }
    }
    const passing = await summarizeEvaluationCycle({ cycleDir: temporaryRoot });
    assert.equal(passing.uniqueActorCount, 9);
    assert.equal(passing.releaseDecision, "pass");

    const runThree = path.join(temporaryRoot, "runs", "run-3");
    const reused = actorIdFor(1);
    const metrics = JSON.parse(await readFile(path.join(runThree, "metrics.json"), "utf8"));
    metrics.actorIds[0] = reused;
    await writeFile(path.join(runThree, "metrics.json"), `${JSON.stringify(metrics)}\n`, "utf8");
    await writeFile(path.join(runThree, "selection-meta.json"), `${JSON.stringify({ run: 3, role: "selection", actorId: reused })}\n`, "utf8");
    const failing = await summarizeEvaluationCycle({ cycleDir: temporaryRoot });
    assert.equal(failing.releaseDecision, "fail");
    assert.deepEqual(failing.reasonCodes, ["GLOBAL_ROLE_ACTOR_REUSE"]);

    await mkdir(path.join(temporaryRoot, "runs", "run-4"));
    await assert.rejects(() => summarizeEvaluationCycle({ cycleDir: temporaryRoot }), /EXACTLY_THREE_RUN_DIRECTORIES_REQUIRED/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

function sourceManifest(source) {
  const digest = sha256(source);
  return {
    schemaVersion: "1.0.0",
    sourceDigest: digest,
    sourceLength: source.length,
    units: [{ unitId: "unit-0001", start: 0, end: source.length, kind: "prose", digest, protectedSpanIds: [] }],
  };
}

function selectionProduct(source, action) {
  return {
    schemaVersion: "1.0.0",
    actorId: actorIds[0],
    sourceDigest: sha256(source),
    status: "ready",
    decisions: [{ unitId: "unit-0001", action, reasonCodes: action === "edit" ? ["TRANSLATIONESE"] : [], riskFlags: [], additionalProtectedStrings: [], issueRanges: action === "edit" ? [{ start: 0, end: source.length, reasonCode: "TRANSLATIONESE" }] : [] }],
  };
}

function editingProduct(source, selection, edits) {
  let candidate = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) candidate = `${candidate.slice(0, edit.start)}${edit.replacement}${candidate.slice(edit.end)}`;
  return {
    schemaVersion: "1.0.0",
    actorId: actorIds[1],
    sourceDigest: sha256(source),
    selectionDigest: workProductDigest(selection),
    edits,
    candidateDigest: sha256(candidate),
  };
}

function verificationProduct(sourceDigest, editing, rubricDigest, decisions) {
  return {
    schemaVersion: "1.0.0",
    actorId: actorIds[2],
    sourceDigest,
    editingDigest: workProductDigest(editing),
    rubricDigest,
    globalDecision: "continue",
    decisions: decisions.map((decision) => ({
      sourceDefect: decision.decision === "accept" ? "TRANSLATIONESE" : "NONE",
      invariantDelta: decision.decision === "accept" ? "NONE" : "UNCERTAIN",
      ...decision,
    })),
    assessment: {
      meaningPreservation: "pass",
      majorMeaningChange: false,
      registerCompliance: "pass",
      protectedStrings: "pass",
      terminologyJudgment: "not-applicable",
      pairPreference: decisions.some((item) => item.decision === "accept") ? "candidate" : "tie",
    },
  };
}

function makeCaseProducts(source, edited) {
  const manifest = sourceManifest(source);
  const selection = selectionProduct(source, edited ? "edit" : "retain");
  const edits = edited ? [{
    id: "edit-1", unitId: "unit-0001", sourceDigest: manifest.sourceDigest,
    start: source.length - 1, end: source.length, replacement: "!", actorId: actorIds[1],
  }] : [];
  const editing = editingProduct(source, selection, edits);
  const verification = verificationProduct(manifest.sourceDigest, editing, sha256("rubric"), edits.map((edit) => ({ editId: edit.id, decision: "accept", reasonCode: "MEANING_PRESERVED" })));
  return { manifest, selection, editing, verification };
}

function releaseThresholds() {
  return {
    protectedExactRate: 100,
    legacyMeaningPassRate: 99,
    legacyImprovementRate: 80,
    legacyRegressionRateMax: 5,
    legacyRestraintSuccessRate: 90,
    holdoutMajorMeaningFailuresMax: 0,
    holdoutProtectedFailuresMax: 0,
    holdoutImprovementRate: 80,
    holdoutRestraintSuccessRate: 85,
    roleReuseMax: 0,
    missingEvidenceMax: 0,
    rubricChangesMax: 0,
  };
}

function actorIdFor(value) {
  const digits = String(value).padStart(12, "0");
  return `00000000-0000-4000-8000-${digits}`;
}

async function seedPreparationRepository(temporaryRoot) {
  const cycle = path.join(temporaryRoot, "evals", "cycles", "test-cycle");
  const corpus = path.join(temporaryRoot, "evals", "legacy", "translationese-100");
  await mkdir(path.join(cycle, "holdout"), { recursive: true });
  await mkdir(path.join(cycle, "policies"), { recursive: true });
  await mkdir(path.join(cycle, "schemas"), { recursive: true });
  await mkdir(corpus, { recursive: true });
  const legacy = Array.from({ length: 100 }, (_, index) => ({
    id: `T${String(index + 1).padStart(3, "0")}`, genre: "test", context: null, input: `원문 ${index + 1}`,
    register: "preserve", meaning_constraints: [], protected_strings: [],
  }));
  const legacyKey = legacy.map((item) => ({ id: item.id, recommendedAction: "retain" }));
  const legacyText = `${legacy.map(JSON.stringify).join("\n")}\n`;
  const holdout = Array.from({ length: 30 }, (_, index) => ({
    id: `F${index + 1}`, genre: "test", context: null, sourceText: `비공개 ${index + 1}`,
    userRequest: "다듬어 주세요.", register: "preserve", meaningConstraints: [], protectedStrings: [],
    expectedDecision: ["edit", "retain", "defer"][index % 3],
  }));
  const thresholds = { schemaVersion: "1.0.0", release: releaseThresholds(), diagnostic: { editRecallMinimum: 15, editRecallDenominator: 18, restraintMinimum: 18, restraintDenominator: 20 } };
  const definition = {
    schemaVersion: "1.0.0", cycleId: "test-cycle", runCount: 3,
    paths: {
      corpus: "evals/legacy/translationese-100/corpus.jsonl",
      legacyKey: "evals/legacy/translationese-100/validation-baseline.jsonl",
      protocol: "evals/cycles/test-cycle/EVALUATION_PROTOCOL.md",
      thresholds: "evals/cycles/test-cycle/thresholds.json",
      policies: ["evals/cycles/test-cycle/policies/selection.md"],
      privateSchemas: ["evals/cycles/test-cycle/schemas/private.json"],
    },
  };
  await Promise.all([
    writeFile(path.join(corpus, "corpus.jsonl"), legacyText, "utf8"),
    writeFile(path.join(corpus, "validation-baseline.jsonl"), `${legacyKey.map(JSON.stringify).join("\n")}\n`, "utf8"),
    writeFile(path.join(cycle, "holdout", "cases.json"), `${JSON.stringify(holdout, null, 2)}\n`, "utf8"),
    writeFile(path.join(cycle, "EVALUATION_PROTOCOL.md"), "protocol\n", "utf8"),
    writeFile(path.join(cycle, "thresholds.json"), `${JSON.stringify(thresholds, null, 2)}\n`, "utf8"),
    writeFile(path.join(cycle, "policies", "selection.md"), "policy\n", "utf8"),
    writeFile(path.join(cycle, "schemas", "private.json"), "{}\n", "utf8"),
    writeFile(path.join(cycle, "cycle-definition.json"), `${JSON.stringify(definition, null, 2)}\n`, "utf8"),
    writeFile(path.join(temporaryRoot, "evals", "FREEZE.json"), `${JSON.stringify({ bindings: { legacyCorpusSha256: sha256(legacyText) }, thresholds: releaseThresholds() }, null, 2)}\n`, "utf8"),
  ]);
}
