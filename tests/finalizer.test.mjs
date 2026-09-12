import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRequest, formatFinalizationResponse } from "../skills/korean-prose-editor/scripts/finalizer-core.mjs";
import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";
import { sha256 } from "../skills/korean-prose-editor/scripts/lib.mjs";
import { validateProviderPlan } from "../skills/korean-prose-editor/scripts/provider-plan.mjs";

const actors = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function plan(actorIds = actors) {
  return {
    schemaVersion: "1.0.0",
    actorIds,
    providers: {
      selection: { kind: "agent", actorId: actorIds[0] },
      editing: { kind: "agent", actorId: actorIds[1] },
      verification: { kind: "agent", actorId: actorIds[2] },
      finalization: { kind: "deterministic", entrypoint: "scripts/finalize.mjs" },
    },
  };
}

function request(source, edits, decisions, overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    mode: "mcp",
    subagentsAvailable: true,
    plan: plan(),
    source,
    manifest: extractProtectedSpans(source),
    edits: edits.map((edit) => ({ sourceDigest: sha256(source), actorId: actors[1], ...edit })),
    verification: { actorId: actors[2], globalDecision: "continue", decisions },
    ...overrides,
  };
}

test("retain leaves a rejected edit unchanged", () => {
  const source = "검토가 진행되었습니다.";
  const edit = { id: "edit-1", start: 0, end: source.length, replacement: "운영팀이 검토했습니다." };
  const result = finalizeRequest(request(source, [edit], [{ editId: "edit-1", decision: "retain", reasonCode: "ACTOR_UNKNOWN" }]));
  assert.equal(result.output, source);
  assert.equal(result.receipt.decisions.status, "finalized");
  assert.equal(result.receipt.decisions.retainedEditDigests.length, 1);
});

test("partial revert applies accepted edits and retains rejected edits", () => {
  const source = "안내를 시작하겠습니다. 결과는 좋았습니다.";
  const first = { id: "edit-1", start: 0, end: 12, replacement: "안내합니다." };
  const secondStart = source.indexOf("결과");
  const second = { id: "edit-2", start: secondStart, end: source.length, replacement: "결과는 완벽했습니다." };
  const decisions = [
    { editId: "edit-1", decision: "accept", reasonCode: "MEANING_PRESERVED" },
    { editId: "edit-2", decision: "retain", reasonCode: "CLAIM_STRENGTH_CHANGED" },
  ];
  const result = finalizeRequest(request(source, [first, second], decisions));
  assert.equal(result.output, "안내합니다. 결과는 좋았습니다.");
  assert.equal(result.receipt.decisions.appliedEditDigests.length, 1);
  assert.equal(result.receipt.decisions.retainedEditDigests.length, 1);
});

test("an edit touching protected text is retained", () => {
  const source = "마감은 2026-09-12입니다.";
  const start = source.indexOf("2026");
  const edit = { id: "date-edit", start, end: start + 10, replacement: "2026-09-13" };
  const result = finalizeRequest(request(source, [edit], [{ editId: "date-edit", decision: "accept", reasonCode: "MEANING_PRESERVED" }]));
  assert.equal(result.output, source);
  assert.ok(result.receipt.warnings.includes("PROTECTED_EDIT_RETAINED"));
});

test("a changed Korean counter is retained while a separate prose edit is applied", () => {
  const source = "오류는 12건입니다. 검토가 진행되었습니다.";
  const number = source.indexOf("12");
  const prose = source.indexOf("검토");
  const edits = [
    { id: "number", start: number, end: number + 2, replacement: "13" },
    { id: "prose", start: prose, end: source.length, replacement: "검토했습니다." },
  ];
  const result = finalizeRequest(request(source, edits, edits.map((edit) => ({ editId: edit.id, decision: "accept", reasonCode: "MEANING_PRESERVED" }))));
  assert.equal(result.output, "오류는 12건입니다. 검토했습니다.");
  assert.deepEqual(result.receipt.warnings, ["PROTECTED_EDIT_RETAINED"]);
});

test("global fallback restores the complete source", () => {
  const source = "첫 문장입니다. 둘째 문장입니다.";
  const edit = { id: "edit-1", start: 0, end: 7, replacement: "첫 문장이다." };
  const input = request(source, [edit], [{ editId: "edit-1", decision: "accept", reasonCode: "MEANING_PRESERVED" }]);
  input.verification.globalDecision = "fallback";
  const result = finalizeRequest(input);
  assert.equal(result.output, source);
  assert.equal(result.receipt.decisions.fallback, true);
  assert.ok(result.receipt.warnings.includes("GLOBAL_FALLBACK_APPLIED"));
});

test("provider plan requires exactly three unique language actors", () => {
  assert.throws(() => validateProviderPlan(plan([actors[0], actors[0], actors[2]]), { subagentsAvailable: true }), { code: "ACTOR_UNIQUENESS" });
  assert.throws(() => validateProviderPlan(plan([actors[0], actors[1]]), { subagentsAvailable: true }), { code: "ACTOR_COUNT" });
  assert.throws(() => validateProviderPlan(plan(), { subagentsAvailable: false }), { code: "SUBAGENTS_UNAVAILABLE" });
});

test("MCP receipt contains no raw source or replacement text", () => {
  const source = "비밀 원문은 장황합니다.";
  const replacement = "비밀 원문은 깁니다.";
  const edit = { id: "sensitive-edit", start: 0, end: source.length, replacement };
  const result = finalizeRequest(request(source, [edit], [{ editId: "sensitive-edit", decision: "accept", reasonCode: "MEANING_PRESERVED" }]));
  const response = formatFinalizationResponse(result, "mcp");
  const serialized = JSON.stringify(response);
  assert.deepEqual(Object.keys(response), ["schemaVersion", "actorIds", "digest", "length", "decisions", "warnings"]);
  assert.equal(serialized.includes(source), false);
  assert.equal(serialized.includes(replacement), false);
  assert.equal(serialized.includes("sensitive-edit"), false);
});

test("final receipt binds exactly the three language actors", () => {
  const source = "문장을 유지합니다.";
  const result = finalizeRequest(request(source, [], []));
  assert.deepEqual(result.receipt.actorIds, actors);
  assert.equal(new Set(result.receipt.actorIds).size, 3);
});

test("direct response is always unverified", () => {
  const source = "문장을 유지합니다.";
  const input = request(source, [], [], { mode: "direct" });
  const result = finalizeRequest(input);
  const response = formatFinalizationResponse(result, "direct");
  assert.equal(response.verificationStatus, "unverified");
  assert.equal(response.receipt.decisions.assurance, "unverified");
});
