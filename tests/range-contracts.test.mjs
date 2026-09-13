import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { sha256 } from "../skills/korean-prose-editor/scripts/lib.mjs";

const root = new URL("../skills/korean-prose-editor/contracts/", import.meta.url);
const readSchema = async (name) => JSON.parse(await readFile(new URL(`${name}.schema.json`, root), "utf8"));
const actorIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const digest = sha256("artifact");

test("private work-product schemas validate their closed range contracts", async () => {
  const samples = {
    "source-unit-manifest.v1": { schemaVersion: "1.0.0", sourceDigest: digest, sourceLength: 4, units: [{ unitId: "unit-0001", start: 0, end: 4, kind: "prose", digest, protectedSpanIds: [] }] },
    "selection-work-product.v1": { schemaVersion: "1.0.0", actorId: actorIds[0], sourceDigest: digest, status: "ready", decisions: [{ unitId: "unit-0001", action: "edit", reasonCodes: ["TRANSLATIONESE"], riskFlags: [], additionalProtectedStrings: ["이름"], issueRanges: [{ start: 0, end: 1, reasonCode: "TRANSLATIONESE" }] }] },
    "editing-work-product.v1": { schemaVersion: "1.0.0", actorId: actorIds[1], sourceDigest: digest, selectionDigest: digest, edits: [{ id: "edit-1", unitId: "unit-0001", sourceDigest: digest, start: 0, end: 1, replacement: "문", actorId: actorIds[1] }], candidateDigest: digest },
    "verification-work-product.v1": { schemaVersion: "1.0.0", actorId: actorIds[2], sourceDigest: digest, editingDigest: digest, rubricDigest: digest, globalDecision: "continue", decisions: [{ editId: "edit-1", decision: "accept", reasonCode: "MEANING_PRESERVED", sourceDefect: "TRANSLATIONESE", invariantDelta: "NONE" }], assessment: { meaningPreservation: "pass", majorMeaningChange: false, registerCompliance: "pass", protectedStrings: "pass", terminologyJudgment: "not-applicable", pairPreference: "candidate" } },
  };

  for (const [name, sample] of Object.entries(samples)) {
    const validate = new Ajv2020({ strict: false }).compile(await readSchema(name));
    assert.equal(validate(sample), true, `${name}: ${JSON.stringify(validate.errors)}`);
    assert.equal(validate({ ...sample, unexpected: true }), false, `${name} must close the root object`);
  }
});

test("selection work products cannot carry a proposed replacement", async () => {
  const validate = new Ajv2020({ strict: false }).compile(await readSchema("selection-work-product.v1"));
  const selection = { schemaVersion: "1.0.0", actorId: actorIds[0], sourceDigest: digest, status: "ready", decisions: [{ unitId: "unit-0001", action: "edit", reasonCodes: ["TRANSLATIONESE"], riskFlags: [], additionalProtectedStrings: [], issueRanges: [{ start: 0, end: 1, reasonCode: "TRANSLATIONESE" }], replacement: "미리 쓴 문장" }] };
  assert.equal(validate(selection), false);
});

test("selection edit decisions require a concrete issue range and non-edit decisions forbid one", async () => {
  const validate = new Ajv2020({ strict: false }).compile(await readSchema("selection-work-product.v1"));
  const base = { schemaVersion: "1.0.0", actorId: actorIds[0], sourceDigest: digest, status: "ready" };
  assert.equal(validate({ ...base, decisions: [{ unitId: "unit-0001", action: "edit", reasonCodes: [], riskFlags: [], additionalProtectedStrings: [], issueRanges: [] }] }), false);
  assert.equal(validate({ ...base, decisions: [{ unitId: "unit-0001", action: "retain", reasonCodes: ["ALREADY_NATURAL"], riskFlags: [], additionalProtectedStrings: [], issueRanges: [{ start: 0, end: 1, reasonCode: "TRANSLATIONESE" }] }] }), false);
});

test("verification accepts require a concrete source defect and no invariant delta", async () => {
  const schema = await readSchema("verification-work-product.v1");
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const base = { schemaVersion: "1.0.0", actorId: actorIds[2], sourceDigest: digest, editingDigest: digest, rubricDigest: digest, globalDecision: "continue", decisions: [{ editId: "edit-1", decision: "accept", reasonCode: "MEANING_PRESERVED", sourceDefect: "TRANSLATIONESE", invariantDelta: "NONE" }], assessment: { meaningPreservation: "pass", majorMeaningChange: false, registerCompliance: "pass", protectedStrings: "pass", terminologyJudgment: "not-applicable", pairPreference: "candidate" } };
  assert.equal(validate(base), true);
  assert.equal(validate({ ...base, decisions: [{ ...base.decisions[0], sourceDefect: "NONE" }] }), false);
  assert.equal(validate({ ...base, decisions: [{ ...base.decisions[0], invariantDelta: "MODALITY_OR_CERTAINTY" }] }), false);
});

test("finalization request schema requires every structured work product", async () => {
  const names = ["provider-plan", "protected-manifest", "source-unit-manifest.v1", "selection-work-product.v1", "editing-work-product.v1", "verification-work-product.v1"];
  const ajv = new Ajv2020({ strict: false });
  for (const name of names) ajv.addSchema(await readSchema(name));
  const validate = ajv.compile(await readSchema("finalization-request"));
  assert.ok(["sourceUnitManifest", "selection", "editing", "verification", "rubricDigest"].every((field) => validate.schema.required.includes(field)));
  assert.equal(validate({ schemaVersion: "1.0.0", mode: "mcp", subagentsAvailable: true }), false);
});
