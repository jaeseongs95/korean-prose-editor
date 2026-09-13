import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRequest, formatFinalizationResponse } from "../skills/korean-prose-editor/scripts/finalizer-core.mjs";
import { sha256, stableJson } from "../skills/korean-prose-editor/scripts/lib.mjs";
import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";
import { createSourceUnitManifest } from "../skills/korean-prose-editor/scripts/source-units.mjs";

const actors = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

test("finalizer applies a selected edit and individually retains an out-of-scope edit", () => {
  const source = "길게 안내합니다.\n\n이 문단은 유지합니다.";
  const input = request(source, [
    edit(source, "edit-1", "unit-0001", "길게 ", ""),
    edit(source, "edit-2", "unit-0002", "유지", "보존"),
  ], { "unit-0001": "edit", "unit-0002": "retain" });
  const result = finalizeRequest(input);

  assert.equal(result.output, "안내합니다.\n\n이 문단은 유지합니다.");
  assert.equal(result.receipt.decisions.appliedEditDigests.length, 1);
  assert.equal(result.receipt.decisions.retainedEditDigests.length, 1);
  assert.ok(result.receipt.warnings.includes("EDIT_OUT_OF_SCOPE_RETAINED"));
});

test("selection-added strings, fenced code, and missing verification decisions retain only their edits", () => {
  const source = "Alpha 이름을 길게 씁니다.\n```txt\nold\n```\n\n마지막 문단입니다.";
  const input = request(source, [
    edit(source, "name", "unit-0001", "Alpha", "Beta"),
    edit(source, "prose", "unit-0001", "길게 ", ""),
    edit(source, "code", "unit-0002", "old", "new"),
    edit(source, "missing", "unit-0003", "마지막", "끝"),
  ], { "unit-0001": "edit", "unit-0002": "edit", "unit-0003": "edit" }, { protectedByUnit: { "unit-0001": ["Alpha"] }, missingDecisionIds: ["missing"] });
  const result = finalizeRequest(input);

  assert.equal(result.output, "Alpha 이름을 씁니다.\n```txt\nold\n```\n\n마지막 문단입니다.");
  assert.equal(result.receipt.decisions.appliedEditDigests.length, 1);
  assert.equal(result.receipt.decisions.retainedEditDigests.length, 3);
  assert.ok(result.receipt.warnings.includes("PROTECTED_EDIT_RETAINED"));
  assert.ok(result.receipt.warnings.includes("VERIFICATION_DECISION_MISSING"));
});

test("malformed selection, broken digest linkage, and overlapping edits trigger global fallback", () => {
  const source = "길게 안내합니다.";
  const cases = [];
  const malformed = request(source, [edit(source, "edit-1", "unit-0001", "길게 ", "")]);
  malformed.selection.decisions[0].replacement = "금지된 제안";
  cases.push(malformed);
  const brokenDigest = request(source, [edit(source, "edit-1", "unit-0001", "길게 ", "")]);
  brokenDigest.verification.editingDigest = sha256("different");
  cases.push(brokenDigest);
  cases.push(request(source, [edit(source, "edit-1", "unit-0001", "길게", "짧게"), edit(source, "edit-2", "unit-0001", "게 안내", "안내") ]));

  for (const input of cases) {
    const result = finalizeRequest(input);
    assert.equal(result.output, source);
    assert.equal(result.receipt.decisions.fallback, true);
    assert.ok(result.receipt.warnings.includes("GLOBAL_FALLBACK_APPLIED"));
  }
});

test("MCP receipts stay raw-text-free with structured work products", () => {
  const source = "비밀 문장을 길게 씁니다.";
  const input = request(source, [edit(source, "sensitive-edit", "unit-0001", "길게 ", "")]);
  const response = formatFinalizationResponse(finalizeRequest(input), "mcp");
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes(source), false);
  assert.equal(serialized.includes("sensitive-edit"), false);
  assert.equal(serialized.includes("길게"), false);
});

test("a user-facing internal metaphor can change while an explicit schema field stays protected", () => {
  const source = "receiptPolicy를 설정하고 평가 영수증 연결을 확인합니다.";
  const input = request(source, [
    edit(source, "field", "unit-0001", "receiptPolicy", "정책"),
    edit(source, "metaphor", "unit-0001", "영수증 연결", "결과 전달"),
  ], {}, { protectedByUnit: { "unit-0001": ["receiptPolicy"] } });
  const result = finalizeRequest(input);

  assert.equal(result.output, "receiptPolicy를 설정하고 평가 결과 전달을 확인합니다.");
  assert.equal(result.receipt.decisions.appliedEditDigests.length, 1);
  assert.equal(result.receipt.decisions.retainedEditDigests.length, 1);
  assert.ok(result.receipt.warnings.includes("PROTECTED_EDIT_RETAINED"));
});

test("accepted edits fall back when the aggregate assessment says the result is unsafe", () => {
  const source = "길게 안내합니다.";
  const input = request(source, [edit(source, "edit-1", "unit-0001", "길게 ", "")]);
  input.verification.assessment = {
    ...input.verification.assessment,
    meaningPreservation: "fail",
    majorMeaningChange: true,
    pairPreference: "original",
  };
  const result = finalizeRequest(input);

  assert.equal(result.output, source);
  assert.equal(result.receipt.decisions.fallback, true);
  assert.ok(result.receipt.warnings.includes("VERIFICATION_CONTRACT_INVALID"));
});

test("an edit cannot split a UTF-16 surrogate pair", () => {
  const source = "😀 확인합니다.";
  const input = request(source, [{
    id: "broken-surrogate",
    unitId: "unit-0001",
    sourceDigest: sha256(source),
    start: 0,
    end: 1,
    replacement: "X",
    actorId: actors[1],
  }]);
  const result = finalizeRequest(input);

  assert.equal(result.output, source);
  assert.equal(result.receipt.decisions.fallback, true);
  assert.ok(result.receipt.warnings.includes("EDIT_CONTRACT_INVALID"));
});

test("an accept decision cannot carry a contradictory reason code", () => {
  const source = "길게 안내합니다.";
  const input = request(source, [edit(source, "edit-1", "unit-0001", "길게 ", "")]);
  input.verification.decisions[0].reasonCode = "MEANING_CHANGED";
  const result = finalizeRequest(input);

  assert.equal(result.output, source);
  assert.equal(result.receipt.decisions.fallback, true);
  assert.ok(result.receipt.warnings.includes("VERIFICATION_DECISION_INVALID"));
});

test("verification rubric digest must match the finalization request", () => {
  const source = "길게 안내합니다.";
  const input = request(source, [edit(source, "edit-1", "unit-0001", "길게 ", "")]);
  input.rubricDigest = sha256("different rubric");
  const result = finalizeRequest(input);

  assert.equal(result.output, source);
  assert.equal(result.receipt.decisions.fallback, true);
  assert.ok(result.receipt.warnings.includes("VERIFICATION_RUBRIC_DIGEST_MISMATCH"));
});

function plan() {
  return { schemaVersion: "1.0.0", actorIds: actors, providers: { selection: { kind: "agent", actorId: actors[0] }, editing: { kind: "agent", actorId: actors[1] }, verification: { kind: "agent", actorId: actors[2] }, finalization: { kind: "deterministic", entrypoint: "scripts/finalize.mjs" } } };
}

function edit(source, id, unitId, original, replacement) {
  const start = source.indexOf(original);
  assert.notEqual(start, -1, original);
  return { id, unitId, sourceDigest: sha256(source), start, end: start + original.length, replacement, actorId: actors[1] };
}

function request(source, edits, actions = {}, options = {}) {
  const manifest = extractProtectedSpans(source);
  const sourceUnitManifest = createSourceUnitManifest(source, manifest);
  const selection = {
    schemaVersion: "1.0.0",
    actorId: actors[0],
    sourceDigest: sha256(source),
    status: "ready",
    decisions: sourceUnitManifest.units.map((unit) => ({ unitId: unit.unitId, action: actions[unit.unitId] ?? (unit.kind === "prose" ? "edit" : "retain"), reasonCodes: [], riskFlags: [], additionalProtectedStrings: options.protectedByUnit?.[unit.unitId] ?? [] })),
  };
  const editing = { schemaVersion: "1.0.0", actorId: actors[1], sourceDigest: sha256(source), selectionDigest: sha256(stableJson(selection)), edits, candidateDigest: sha256(applyEdits(source, edits)) };
  const missing = new Set(options.missingDecisionIds ?? []);
  const verification = {
    schemaVersion: "1.0.0",
    actorId: actors[2],
    sourceDigest: sha256(source),
    editingDigest: sha256(stableJson(editing)),
    rubricDigest: sha256("fixed rubric"),
    globalDecision: "continue",
    decisions: edits.filter((item) => !missing.has(item.id)).map((item) => ({ editId: item.id, decision: "accept", reasonCode: "MEANING_PRESERVED" })),
    assessment: { meaningPreservation: "pass", majorMeaningChange: false, registerCompliance: "pass", protectedStrings: "pass", terminologyJudgment: "not-applicable", pairPreference: "candidate" },
  };
  return { schemaVersion: "1.0.0", mode: "mcp", subagentsAvailable: true, plan: plan(), source, manifest, sourceUnitManifest, selection, editing, verification, rubricDigest: verification.rubricDigest };
}

function applyEdits(source, edits) {
  let result = source;
  for (const item of [...edits].sort((left, right) => right.start - left.start)) result = `${result.slice(0, item.start)}${item.replacement}${result.slice(item.end)}`;
  return result;
}
