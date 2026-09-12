import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { finalizeEvaluationCase } from "../scripts/evaluation-finalizer.mjs";

const contractRoot = new URL("../skills/korean-prose-editor/contracts/", import.meta.url);
const readSchema = async (name) => JSON.parse(await readFile(new URL(`${name}.schema.json`, contractRoot), "utf8"));

test("both final receipt schemas enumerate every deterministic runtime warning and reject arbitrary text", async () => {
  const emitted = new Set();
  for (const name of ["finalizer-core", "result-checker"]) {
    const code = await readFile(new URL(`../skills/korean-prose-editor/scripts/${name}.mjs`, import.meta.url), "utf8");
    for (const match of code.matchAll(/warnings\.add\("([A-Z][A-Z0-9_]*)"\)/gu)) emitted.add(match[1]);
  }
  const actorIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const { receipt } = finalizeEvaluationCase({ sourceText: "비밀 원문", candidateText: "비밀 원문", actorIds, verification: { actorId: actorIds[2], finalDecision: "retain" } });
  for (const name of ["receipt", "final-text-receipt.v1"]) {
    const schema = await readSchema(name);
    assert.deepEqual([...schema.properties.warnings.items.enum].sort(), [...emitted].sort());
    const validate = new Ajv2020({ strict: false }).compile(schema);
    for (const warning of emitted) assert.equal(validate({ ...receipt, warnings: [warning] }), true, warning);
    assert.equal(validate({ ...receipt, warnings: ["ARBITRARY_SOURCE_TEXT"] }), false);
    assert.equal(validate({ ...receipt, source: "비밀 원문" }), false);
  }
});

test("role receipt warnings use narrow finite tokens with no free-text pattern", async () => {
  for (const name of ["edit-decision-set.v1", "edit-candidate.v1", "edit-verification-report.v1"]) {
    const schema = await readSchema(name);
    const items = schema.$defs.warnings.items;
    assert.ok(items.enum.length > 0 && items.enum.length <= 7);
    assert.equal(Object.hasOwn(items, "pattern"), false);
    assert.equal(new Set(items.enum).size, items.enum.length);
    assert.ok(items.enum.every((code) => /^[A-Z][A-Z0-9_]*$/u.test(code)));
    const validate = new Ajv2020({ strict: false }).compile(schema.$defs.warnings);
    assert.equal(validate([items.enum[0]]), true);
    assert.equal(validate(["ARBITRARY_SOURCE_TEXT"]), false);
  }
});

test("descriptor actor-list binding fields are optional together and required as a pair", async () => {
  const schema = JSON.parse(await readFile(new URL("../skills/korean-prose-editor/integration/skill-descriptor.v2.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema.$defs.receiptPolicy);
  const policy = { mode: "reference-only", actorIdsPointer: "/output/actorIds", actorIdsMatch: "prior-policy-actors" };
  assert.equal(validate(policy), true);
  assert.equal(validate({ mode: "reference-only" }), true);
  for (const field of ["actorIdsPointer", "actorIdsMatch"]) {
    const partial = { ...policy };
    delete partial[field];
    assert.equal(validate(partial), false);
  }
});
