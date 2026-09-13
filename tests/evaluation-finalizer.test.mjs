import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvaluationCase } from "../scripts/evaluation-finalizer.mjs";
import { structuredCase } from "./helpers/structured-work-products.mjs";

test("adapter applies only explicitly recorded edits and emits a text-free MCP receipt", () => {
  const source = "안내를 시작합니다. 12건을 검토하였습니다. `pnpm test`를 실행하였습니다.";
  const input = structuredCase(source, [
    { original: "를 시작", replacement: "" },
    { original: "하였", replacement: "했" },
    { original: "하였", replacement: "했", start: source.lastIndexOf("하였") },
  ]);
  const result = finalizeEvaluationCase(input);

  assert.equal(result.candidateText, "안내합니다. 12건을 검토했습니다. `pnpm test`를 실행했습니다.");
  assert.equal(result.finalText, result.candidateText);
  assert.equal(result.finalAction, "edit");
  assert.equal(result.receipt.decisions.appliedEditDigests.length, 3);
  assert.equal(JSON.stringify(result.receipt).includes(source), false);
});

test("one rejected edit is restored without discarding an independent accepted edit", () => {
  const source = "장황하게 안내합니다. 결과는 좋았습니다.";
  const input = structuredCase(source, [
    { id: "safe", original: "장황하게 ", replacement: "" },
    { id: "unsafe", original: "좋았습니다", replacement: "완벽했습니다" },
  ], { retainedEditIds: ["unsafe"] });
  const result = finalizeEvaluationCase(input);

  assert.equal(result.candidateText, "안내합니다. 결과는 완벽했습니다.");
  assert.equal(result.finalText, "안내합니다. 결과는 좋았습니다.");
  assert.equal(result.receipt.decisions.appliedEditDigests.length, 1);
  assert.equal(result.receipt.decisions.retainedEditDigests.length, 1);
});

test("a protected edit is retained while surrounding prose can still change", () => {
  const source = "12건을 장황하게 검토하였습니다.";
  const input = structuredCase(source, [
    { id: "number", original: "12", replacement: "13" },
    { id: "prose", original: "장황하게 ", replacement: "" },
  ]);
  const result = finalizeEvaluationCase(input);

  assert.equal(result.finalText, "12건을 검토하였습니다.");
  assert.equal(result.receipt.decisions.appliedEditDigests.length, 1);
  assert.equal(result.receipt.decisions.retainedEditDigests.length, 1);
});

test("global verification fallback restores the complete source", () => {
  const source = "장황하게 안내합니다.";
  const input = structuredCase(source, [{ original: "장황하게 ", replacement: "" }], { globalDecision: "fallback" });
  const result = finalizeEvaluationCase(input);

  assert.equal(result.candidateText, "안내합니다.");
  assert.equal(result.finalText, source);
  assert.equal(result.restored, true);
  assert.equal(result.receipt.decisions.fallback, true);
});

test("adapter rejects missing structured artifacts instead of reconstructing a diff", () => {
  assert.throws(() => finalizeEvaluationCase({
    sourceText: "검토하였습니다.",
    candidateText: "검토했습니다.",
    actorIds: [],
  }), /actorIds must contain three role actors/u);
});

test("adapter rejects a declared protected string that is absent from the source", () => {
  const input = structuredCase("검토하였습니다.");
  input.protectedStrings = ["없는 이름"];
  assert.throws(() => finalizeEvaluationCase(input), /protectedStrings must contain/u);
});
