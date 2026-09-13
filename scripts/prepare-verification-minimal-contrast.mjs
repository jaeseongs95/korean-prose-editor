#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { serializeJsonl, sha256, validateEditingWorkProduct, validateSelectionWorkProduct, workProductDigest, writeNewFile } from "./lib/evaluation-cycle.mjs";
import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";
import { createSourceUnitManifest } from "../skills/korean-prose-editor/scripts/source-units.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const cycleDir = resolveCycleDir(options["cycle-dir"]);
const suite = options.suite ?? "minimal-contrast";
if (!/^minimal-contrast(?:-[0-9]+)?$/u.test(suite)) throw new Error("invalid --suite");
const directory = path.join(cycleDir, "diagnostic", "semantic-regression", suite);
const spec = JSON.parse(await readFile(path.join(directory, "spec.json"), "utf8"));
if (!Array.isArray(spec) || spec.length === 0) throw new Error("VERIFICATION_CONTRAST_COUNT_MISMATCH");
const selectionActor = "44444444-4444-4444-8444-444444444444";
const editingActor = "55555555-5555-4555-8555-555555555555";
const input = [];
const key = [];
const manifests = [];
const selections = [];
const editings = [];
for (const item of spec) {
  const sourceDigest = sha256(item.sourceText);
  const manifest = createSourceUnitManifest(item.sourceText, extractProtectedSpans(item.sourceText, []));
  const unit = manifest.units[0];
  const selection = {
    schemaVersion: "1.0.0", actorId: selectionActor, sourceDigest, status: "ready",
    decisions: [{ unitId: unit.unitId, action: "edit", reasonCodes: ["TRANSLATIONESE"], riskFlags: [], additionalProtectedStrings: [], issueRanges: [{ start: 0, end: item.sourceText.length, reasonCode: "TRANSLATIONESE" }] }],
  };
  const edit = { id: `edit-${item.id}`, unitId: unit.unitId, sourceDigest, start: 0, end: item.sourceText.length, replacement: item.replacement, actorId: editingActor };
  const editing = { schemaVersion: "1.0.0", actorId: editingActor, sourceDigest, selectionDigest: workProductDigest(selection), edits: [edit], candidateDigest: sha256(item.replacement) };
  validateSelectionWorkProduct(selection, manifest, item.sourceText);
  validateEditingWorkProduct(editing, { source: item.sourceText, manifest, selection });
  input.push({ schemaVersion: "1.0.0", id: item.id, sourceCaseId: item.id, sourceText: item.sourceText, userRequest: "의미를 유지하며 필요한 부분만 자연스럽게 다듬어 주세요.", register: "격식체", meaningConstraints: item.meaningConstraints, protectedStrings: [], edit: { id: edit.id, sourceDigest, start: edit.start, end: edit.end, replacement: edit.replacement, candidateDigest: editing.candidateDigest } });
  key.push({ id: item.id, expectedDecision: item.expectedDecision });
  manifests.push(manifest);
  selections.push(selection);
  editings.push(editing);
}
await writeNewFile(path.join(directory, "input.jsonl"), serializeJsonl(input));
await writeNewFile(path.join(directory, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
await writeNewFile(path.join(directory, "source-unit-manifest.jsonl"), serializeJsonl(manifests));
await writeNewFile(path.join(directory, "selection-work-product.jsonl"), serializeJsonl(selections));
await writeNewFile(path.join(directory, "editing-work-product.jsonl"), serializeJsonl(editings));
console.log(JSON.stringify({ caseCount: input.length }));

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
