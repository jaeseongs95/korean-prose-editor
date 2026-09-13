import assert from "node:assert/strict";
import test from "node:test";
import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";
import { createSourceUnitManifest } from "../skills/korean-prose-editor/scripts/source-units.mjs";

test("unitization separates prose paragraphs and fenced code while preserving source offsets", () => {
  const source = "  첫 문단입니다.  \r\n  \r\n둘째 문단입니다.\r\n```js\r\nconst count = 12;\r\n```\r\n\r\n마지막 문단입니다.\r\n";
  const manifest = extractProtectedSpans(source);
  const units = createSourceUnitManifest(source, manifest).units;

  assert.deepEqual(units.map((unit) => unit.kind), ["prose", "prose", "fenced-code", "prose"]);
  assert.deepEqual(units.map((unit) => source.slice(unit.start, unit.end)), [
    "첫 문단입니다.",
    "둘째 문단입니다.",
    "```js\r\nconst count = 12;\r\n```\r\n",
    "마지막 문단입니다.",
  ]);
  assert.deepEqual(units[2].protectedSpanIds, [manifest.spans.find((span) => span.kind === "fenced-code").id]);
  for (let index = 1; index < units.length; index += 1) assert.ok(units[index - 1].end <= units[index].start);
});

test("unitization is deterministic and treats an unclosed fence as code through EOF", () => {
  const source = "도입입니다.\n\n~~~text\n닫히지 않은 코드\n";
  const manifest = extractProtectedSpans(source);
  const first = createSourceUnitManifest(source, manifest);
  const second = createSourceUnitManifest(source, manifest);

  assert.deepEqual(first, second);
  assert.deepEqual(first.units.map((unit) => unit.kind), ["prose", "fenced-code"]);
  assert.equal(first.units[1].end, source.length);
  assert.equal(source.slice(first.units[1].start), "~~~text\n닫히지 않은 코드\n");
});

test("whitespace-only sources produce no editable units", () => {
  const source = " \r\n\t";
  assert.deepEqual(createSourceUnitManifest(source, extractProtectedSpans(source)).units, []);
});
