#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { serializeJsonl, sha256, writeNewFile } from "./lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cycleArgument = valueAfter("--cycle-dir");
if (!cycleArgument) throw new Error("--cycle-dir is required");
const cyclesRoot = path.resolve(root, "evals", "cycles");
const cycleDir = path.resolve(root, cycleArgument);
if (cycleDir === cyclesRoot || !cycleDir.startsWith(`${cyclesRoot}${path.sep}`)) throw new Error("cycle directory must be a child of evals/cycles");

const historicalInputText = await readFile(path.join(root, "evals", "runs", "input.jsonl"), "utf8");
const historicalInput = historicalInputText.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
const historicalById = new Map(historicalInput.map((item) => [item.id, item]));
const inventoryFile = path.join(cycleDir, "diagnostic", "inventory.json");
const inventoryText = await readFile(inventoryFile, "utf8");
const inventory = JSON.parse(inventoryText);

const selected = [...inventory.editCases, ...inventory.controlCases].map((item) => {
  const source = historicalById.get(item.caseId);
  if (!source) throw new Error(`DIAGNOSTIC_SOURCE_MISSING:${item.caseId}`);
  return {
    ...source,
    protectedStrings: source.protectedStrings.filter((value) => source.sourceText.includes(value)),
  };
});
const regressionInputs = inventory.regressionCases.map((item) => ({
  id: item.caseId,
  suite: "diagnostic-regression",
  genre: item.category,
  context: item.judgmentTarget,
  sourceText: item.sourceText,
  userRequest: item.userRequest,
  register: "preserve",
  meaningConstraints: [item.judgmentTarget],
  protectedStrings: item.protectedStrings,
}));
const input = [...selected, ...regressionInputs];
const key = [
  ...inventory.editCases.map((item) => ({ id: item.caseId, expectedDecision: "edit" })),
  ...inventory.controlCases.map((item) => ({ id: item.caseId, expectedDecision: item.sourceId.startsWith("A") || ["P05", "P06"].includes(item.sourceId) ? "defer" : "retain" })),
  ...inventory.regressionCases.map((item) => ({ id: item.caseId, expectedDecision: item.expectedDecision })),
];
if (input.length !== 39 || new Set(input.map((item) => item.id)).size !== 39) throw new Error("DIAGNOSTIC_CASE_COUNT_MISMATCH");

const inputText = serializeJsonl(input);
const keyText = `${JSON.stringify(key, null, 2)}\n`;
const manifest = {
  schemaVersion: "1.0.0",
  cycleId: path.basename(cycleDir),
  caseCount: input.length,
  fixedDiagnosticCounts: { edit: 18, control: 20, userFacingJargon: 1 },
  inputSha256: sha256(inputText),
  keySha256: sha256(keyText),
  inventorySha256: sha256(inventoryText),
  historicalInputSha256: sha256(historicalInputText),
  runCount: 3,
  thresholds: inventory.thresholds,
};
await writeNewFile(path.join(cycleDir, "diagnostic", "input.jsonl"), inputText);
await writeNewFile(path.join(cycleDir, "diagnostic", "key.json"), keyText);
await writeNewFile(path.join(cycleDir, "diagnostic", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`prepared ${input.length} known diagnostic cases`);

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}
