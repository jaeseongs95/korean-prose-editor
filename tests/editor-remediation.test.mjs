import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../scripts/lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cycleRoot = path.join(root, "evals", "cycles", "0.1.0-rc2");
const recoveryRoot = path.join(cycleRoot, "recovery", "corpus-validity-v1");

test("public remediation fixtures cover only the diagnosed editor boundary", async () => {
  const fixture = JSON.parse(await readFile(path.join(cycleRoot, "remediation", "editor-regressions.json"), "utf8"));
  assert.equal(fixture.purpose, "public-editor-regression-only");
  assert.equal(fixture.gateEligible, false);
  assert.equal(fixture.comparableToRecovery, false);
  assert.deepEqual(fixture.cases.map((item) => item.sourceCaseId), [
    "recovery:R002",
    "recovery:R004",
    "recovery:R006",
    "recovery:R008",
  ]);
  assert.ok(fixture.cases.every((item) =>
    item.sourceText !== item.safeCandidate &&
    item.sourceText !== item.unsafeCandidate &&
    item.safeCandidate !== item.unsafeCandidate &&
    item.requiredInvariant.length > 0));
  assert.equal(fixture.cases.find((item) => item.sourceCaseId === "recovery:R006").unsafeCandidate.startsWith(" "), true);
  assert.equal(fixture.cases.find((item) => item.sourceCaseId === "recovery:R006").safeCandidate.startsWith(" "), false);
});

test("editing policy encodes the three diagnosed editor checks", async () => {
  const policy = await readFile(path.join(root, "skills", "korean-prose-editor", "references", "editing-policy.md"), "utf8");
  assert.match(policy, /원문에 명시된 범주와 용어/u);
  assert.match(policy, /대리 명사를 새로 넣/u);
  assert.match(policy, /문두·문미 공백/u);
  assert.match(policy, /issue range는 edit가 겹쳐야 하는 결함 위치/u);
});

test("sealed recovery inputs and key remain byte-identical to their freeze", async () => {
  const freeze = JSON.parse(await readFile(path.join(recoveryRoot, "FREEZE.json"), "utf8"));
  for (const relative of [
    "evals/cycles/0.1.0-rc2/recovery/corpus-validity-v1/contract.json",
    "evals/cycles/0.1.0-rc2/recovery/corpus-validity-v1/input.jsonl",
    "evals/cycles/0.1.0-rc2/recovery/corpus-validity-v1/key.json",
  ]) {
    assert.equal(sha256(await readFile(path.join(root, relative), "utf8")), freeze.bindings[relative]);
  }
  const result = JSON.parse(await readFile(path.join(recoveryRoot, "final-results.json"), "utf8"));
  assert.equal(result.status, "failed-recovery");
  assert.equal(result.counts.editSuccess, 5);
  assert.equal(result.releaseDecision, "not-evaluated");
});
