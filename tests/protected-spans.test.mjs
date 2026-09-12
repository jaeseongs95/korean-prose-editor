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

test("protects Korean counters, units, dates, times and percentages with particles", () => {
  const values = ["12건", "1,200명", "2.5kg", "2026년", "9월", "12일", "오후 3시", "1시간30분", "09:30:45", "12.5%", "-3도", "2026-09-12"];
  for (const value of values) {
    const source = `${value}입니다.`;
    const manifest = extractProtectedSpans(source);
    const candidate = source.replace(/\d/u, "8");
    assert.equal(checkResult(source, candidate, manifest).decisions.protectedSpansPreserved, false, value);
  }
  assert.equal(extractProtectedSpans("검토한 문장은 자연스럽습니다.").spans.length, 0);
});

test("extracts email, Windows and POSIX paths, and marked commands", () => {
  const source = "연락: team@example.com 경로: C:\\work\\draft.md 경로: /srv/docs/draft.md\n$ pnpm test\n이 문장은 고칠 수 있습니다.";
  const manifest = extractProtectedSpans(source);
  assert.deepEqual(manifest.spans.map((span) => span.kind), ["email", "path", "path", "command"]);
  for (const span of manifest.spans) {
    assert.equal(checkResult(source, source.slice(0, span.start) + "변경" + source.slice(span.end), manifest).decisions.protectedSpansPreserved, false);
  }
  assert.equal(checkResult(source, source.replace("고칠 수 있습니다", "고칩니다"), manifest).decisions.protectedSpansPreserved, true);
});

test("code and quotation priority preserves full spans including nested paths and units", () => {
  const source = "`cat /srv/12.txt`와 “오류 12건”\n```sh\ncat /srv/12.txt\n```";
  assert.deepEqual(extractProtectedSpans(source).spans.map((span) => span.kind), ["inline-code", "quotation", "fenced-code"]);
});

test("user-defined names and crossing spans are preserved without swallowing surrounding prose", () => {
  const source = "김민수는 `12건` 처리 사실을 김민수에게 알렸습니다.";
  const manifest = extractProtectedSpans(source, ["김민수", "건` 처리"]);
  assert.deepEqual(manifest.spans.map((span) => span.text), ["김민수", "`12건` 처리", "김민수"]);
  assert.equal(checkResult(source, source.replace("알렸습니다", "전했습니다"), manifest).decisions.protectedSpansPreserved, true);
  assert.throws(() => extractProtectedSpans(source, ["없는 이름"]), TypeError);
  assert.throws(() => extractProtectedSpans(source, [""]), TypeError);
});

test("plain ASCII URLs exclude Korean particles and trailing sentence punctuation", () => {
  const urls = ["https://example.com", "https://example.com/a?q=1&name=%EA%B0%80", "https://example.com/a#section"];
  for (const url of urls) {
    for (const suffix of ["을", "에서", ".", ",", "!", "?", ";", ":"]) {
      const manifest = extractProtectedSpans(`${url}${suffix} 확인합니다.`);
      assert.equal(manifest.spans[0].text, url, `${url}${suffix}`);
    }
  }
  const source = "더 많은 정보를 위해 https://help.example.kr/returns를 방문해 주십시오.";
  const candidate = "자세한 내용은 https://help.example.kr/returns에서 확인해 주십시오.";
  assert.equal(checkResult(source, candidate, extractProtectedSpans(source)).decisions.protectedSpansPreserved, true);
});

test("explicit Markdown destinations preserve URL characters that are ambiguous in bare prose", () => {
  const source = "[문서](https://example.com/한글/a.)입니다.";
  assert.equal(extractProtectedSpans(source).spans[0].text, "https://example.com/한글/a.");
});
