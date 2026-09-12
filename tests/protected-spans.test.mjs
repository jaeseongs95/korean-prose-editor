import assert from "node:assert/strict";
import test from "node:test";
import { checkResult } from "../skills/korean-prose-editor/scripts/result-checker.mjs";
import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";

test("extracts and verifies protected strings without normalizing them", () => {
  const source = "배포일은 2026-09-12다. `pnpm test`와 [문서](https://example.com/a?q=1)를 확인했다. “오류는 0건”이다.";
  const manifest = extractProtectedSpans(source);
  assert.deepEqual(
    manifest.spans.map((span) => span.kind),
    ["number-or-date", "inline-code", "markdown-target", "quotation"],
  );
  const candidate = source.replace("확인했다", "확인했습니다");
  assert.equal(checkResult(source, candidate, manifest).decisions.protectedSpansPreserved, true);
});

test("detects a changed protected span", () => {
  const source = "[문서](https://example.com/v1)에서 12건을 확인했다.";
  const manifest = extractProtectedSpans(source);
  const candidate = source.replace("/v1", "/v2");
  const result = checkResult(source, candidate, manifest);
  assert.equal(result.decisions.protectedSpansPreserved, false);
  assert.ok(result.warnings.includes("PROTECTED_SPAN_MISSING_OR_REORDERED"));
  assert.equal(JSON.stringify(result).includes("https://example.com/v1"), false);
});
