import assert from "node:assert/strict";
import test from "node:test";
import { candidateEdits, finalizeEvaluationCase } from "../scripts/evaluation-finalizer.mjs";
import { extractProtectedSpans, overlapsProtectedSpan } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";

const actorIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const verification = { actorId: actorIds[2], finalDecision: "accept", meaningPreservation: "pass", majorMeaningChange: false, registerCompliance: "pass", protectedStrings: "pass", terminologyJudgment: "not-applicable" };

function finalize(sourceText, candidateText, changes = {}) {
  return finalizeEvaluationCase({ sourceText, candidateText, actorIds, verification, ...changes });
}

test("adapter executes the shipped MCP finalizer with separate minimal edits around protected anchors", () => {
  const source = "안내를 시작합니다. 12건을 검토하였습니다. `pnpm test`를 실행하였습니다.";
  const candidate = "안내합니다. 12건을 검토했습니다. `pnpm test`를 실행했습니다.";
  const manifest = extractProtectedSpans(source);
  const diff = candidateEdits(source, candidate, manifest);
  assert.equal(diff.fallback, false);
  assert.ok(diff.edits.length > 1);
  for (const edit of diff.edits) assert.equal(overlapsProtectedSpan(edit.start, edit.end, manifest.spans), false);
  const result = finalize(source, candidate);
  assert.equal(result.finalText, candidate);
  assert.equal(result.finalAction, "edit");
  assert.equal(result.restored, false);
  assert.equal(result.receipt.decisions.appliedEditDigests.length, diff.edits.length);
  assert.equal(result.receipt.decisions.mode, "mcp");
  assert.deepEqual(result.receipt.actorIds, actorIds);
  assert.equal(JSON.stringify(result.receipt).includes(candidate), false);
});

test("all failing or uncertain verifier dimensions restore the source", () => {
  for (const changes of [
    { finalDecision: "retain" }, { meaningPreservation: "fail" }, { majorMeaningChange: true },
    { registerCompliance: "fail" }, { protectedStrings: "fail" }, { terminologyJudgment: "fail" },
    ...["finalDecision", "meaningPreservation", "registerCompliance", "protectedStrings", "terminologyJudgment"].map((field) => ({ [field]: "uncertain" })),
  ]) {
    const result = finalize("검토하였습니다.", "검토했습니다.", { verification: { ...verification, ...changes } });
    assert.equal(result.finalText, "검토하였습니다.", JSON.stringify(changes));
    assert.equal(result.restored, true);
    assert.equal(result.receipt.decisions.appliedEditDigests.length, 0);
  }
});

test("damaged, duplicated, reordered or missing declared protected strings trigger fallback", () => {
  for (const candidate of ["13건을 검토했다.", "12건 12건을 검토했다.", "14건 다음 12건이다."]) {
    const source = candidate.includes("14") ? "12건 다음 14건이다." : "12건을 검토하였다.";
    const result = finalize(source, candidate);
    assert.equal(result.finalText, source);
    assert.equal(result.receipt.decisions.fallback, true);
  }
  const result = finalize("검토하였습니다.", "검토했습니다.", { protectedStrings: ["없는 이름"] });
  assert.equal(result.finalText, "검토하였습니다.");
  assert.equal(result.receipt.decisions.fallback, true);
});

test("adapter binds recorded editing and verification actor IDs", () => {
  for (const changes of [{ editingActorId: actorIds[0] }, { verification: { ...verification, actorId: actorIds[0] } }]) {
    const result = finalize("검토하였습니다.", "검토했습니다.", changes);
    assert.equal(result.finalText, "검토하였습니다.");
    assert.equal(result.receipt.decisions.fallback, true);
  }
});

test("diff preserves Unicode boundaries and reconstructs insertions, deletions and separated changes", () => {
  for (const [source, candidate] of [["", "추가"], ["삭제", ""], ["😀 확인 및 검토 😀", "😃 확인과 검토 😀"], ["가나다라", "가마나바다라"], ["같은 문장", "같은 문장"]]) {
    const result = finalize(source, candidate);
    assert.equal(result.finalText, candidate);
  }
});

test("an ambiguous anchor or oversized diff falls back instead of guessing", () => {
  const source = "x12 12건";
  const candidate = "12건 x12";
  const manifest = { spans: [{ start: 1, end: 3, text: "12" }] };
  assert.equal(candidateEdits(source, candidate, manifest).fallback, true);
  assert.equal(candidateEdits("가".repeat(2100), "나".repeat(2100), { spans: [] }).fallback, true);
});

test("retain/defer selections cannot be turned into edits and unchanged cases have no applied edits", () => {
  for (const selectionAction of ["retain", "defer"]) {
    assert.equal(finalize("검토하였습니다.", "검토했습니다.", { selectionAction }).finalText, "검토하였습니다.");
  }
  const result = finalize("12건입니다.", "12건입니다.");
  assert.equal(result.finalAction, "retain");
  assert.equal(result.restored, false);
  assert.deepEqual(result.receipt.decisions.appliedEditDigests, []);
});

test("a Korean particle change adjacent to an unchanged URL reaches the shipped finalizer", () => {
  const source = "더 많은 정보를 위해 https://help.example.kr/returns를 방문해 주십시오.";
  const candidate = "자세한 내용은 https://help.example.kr/returns에서 확인해 주십시오.";
  const result = finalize(source, candidate);
  assert.equal(result.finalText, candidate);
  assert.equal(result.receipt.decisions.fallback, false);
});
