#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJsonl, serializeJsonl, writeNewFile } from "./lib/evaluation-cycle.mjs";
import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";
import { createSourceUnitManifest } from "../skills/korean-prose-editor/scripts/source-units.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const cycleDir = resolveCycleDir(options["cycle-dir"]);
const regressionDir = path.join(cycleDir, "diagnostic", "semantic-regression");
const historical = parseJsonl(await readFile(path.join(regressionDir, "input.jsonl"), "utf8"));
const unique = [];
const seen = new Set();
for (const item of historical) {
  if (seen.has(item.sourceCaseId)) continue;
  seen.add(item.sourceCaseId);
  unique.push({
    id: `new:${item.sourceCaseId}`,
    suite: "new-semantic-candidate",
    genre: "known-regression-source",
    context: null,
    sourceText: item.sourceText,
    userRequest: item.userRequest,
    register: item.register,
    meaningConstraints: item.meaningConstraints,
    protectedStrings: item.protectedStrings,
  });
}
if (unique.length !== 11) throw new Error("UNIQUE_SEMANTIC_SOURCE_COUNT_MISMATCH");
const key = unique.map((item) => ({ id: item.id, expectedDecision: "edit" }));
const manifests = unique.map((item) => createSourceUnitManifest(item.sourceText, extractProtectedSpans(item.sourceText, item.protectedStrings)));
const outputDir = path.join(regressionDir, "new-candidates");
await writeNewFile(path.join(outputDir, "input.jsonl"), serializeJsonl(unique));
await writeNewFile(path.join(outputDir, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
await writeNewFile(path.join(outputDir, "source-unit-manifest.jsonl"), serializeJsonl(manifests));
console.log(JSON.stringify({ caseCount: unique.length, requiredImprovementCount: 9, allowedMajorMeaningChanges: 0 }));

function resolveCycleDir(value) {
  if (!value) throw new Error("--cycle-dir is required");
  const cyclesRoot = path.resolve(root, "evals", "cycles");
  const resolved = path.resolve(root, value);
  if (resolved === cyclesRoot || !resolved.startsWith(`${cyclesRoot}${path.sep}`)) throw new Error("cycle directory must be a child of evals/cycles");
  return resolved;
}
function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--") || !arguments_[index + 1] || arguments_[index + 1].startsWith("--")) throw new Error(`invalid argument: ${argument}`);
    parsed[argument.slice(2)] = arguments_[index + 1];
    index += 1;
  }
  return parsed;
}
