import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseJsonl, validateSourceUnitManifest } from "../scripts/lib/evaluation-cycle.mjs";

const contrastRoot = new URL("../evals/cycles/0.1.0-rc2/diagnostic/selection-taxonomy-contrast/", import.meta.url);

test("selection taxonomy contrast is balanced, blinded, and structurally valid", async () => {
  const [inputText, manifestText, keyText, specText] = await Promise.all([
    readFile(new URL("input.jsonl", contrastRoot), "utf8"),
    readFile(new URL("source-unit-manifest.jsonl", contrastRoot), "utf8"),
    readFile(new URL("key.json", contrastRoot), "utf8"),
    readFile(new URL("spec.json", contrastRoot), "utf8"),
  ]);
  const input = parseJsonl(inputText);
  const manifests = parseJsonl(manifestText);
  const key = JSON.parse(keyText);
  const spec = JSON.parse(specText);

  assert.equal(input.length, 10);
  assert.equal(manifests.length, input.length);
  assert.equal(key.length, input.length);
  assert.equal(spec.caseCount, input.length);
  assert.equal(spec.pairCount, 5);
  assert.equal(spec.runCount, 3);
  assert.equal(new Set(input.map((item) => item.id)).size, input.length);
  assert.deepEqual(input.map((item) => item.id), key.map((item) => item.id));

  const decisionsByPair = new Map();
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    assert.equal("expectedDecision" in item, false);
    assert.equal("replacement" in item, false);
    assert.ok(Array.isArray(item.protectedStrings));
    validateSourceUnitManifest(manifests[index], item.sourceText);
    const decisions = decisionsByPair.get(item.pairId) ?? [];
    decisions.push(key[index].expectedDecision);
    decisionsByPair.set(item.pairId, decisions);
  }
  assert.equal(decisionsByPair.size, 5);
  for (const decisions of decisionsByPair.values()) assert.deepEqual(decisions.sort(), ["edit", "retain"]);
});
