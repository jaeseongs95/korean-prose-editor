#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJsonl, serializeJsonl, validateEditingWorkProduct, validateSelectionWorkProduct, validateSourceUnitManifest, workProductDigest, writeNewFile } from "./lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const cycleDir = resolveCycleDir(options["cycle-dir"]);
const regressionDir = path.join(cycleDir, "diagnostic", "semantic-regression");
const input = parseJsonl(await readFile(path.join(regressionDir, "input.jsonl"), "utf8"));
const manifests = parseJsonl(await readFile(path.join(regressionDir, "source-unit-manifest.jsonl"), "utf8"));
const oldActors = await loadHistoricalActors();
const selections = [];
const editings = [];

for (let index = 0; index < input.length; index += 1) {
  const item = input[index];
  const manifest = manifests[index];
  validateSourceUnitManifest(manifest, item.sourceText);
  const historicalRun = Number(item.id.match(/^historical-run-([123]):/u)?.[1]);
  const actors = oldActors.get(historicalRun);
  if (!actors) throw new Error(`HISTORICAL_ACTOR_MISSING:${item.id}`);
  const unit = manifest.units.find((candidate) => candidate.kind === "prose" && candidate.start <= item.edit.start && item.edit.end <= candidate.end);
  if (!unit) throw new Error(`HISTORICAL_EDIT_UNIT_MISSING:${item.id}`);
  const selection = {
    schemaVersion: "1.0.0",
    actorId: actors.selection,
    sourceDigest: manifest.sourceDigest,
    status: "ready",
    decisions: manifest.units.map((candidate) => candidate.unitId === unit.unitId ? {
      unitId: candidate.unitId,
      action: "edit",
      reasonCodes: ["TRANSLATIONESE"],
      riskFlags: ["HISTORICAL_REJECTED_CANDIDATE"],
      additionalProtectedStrings: [],
      issueRanges: [{ start: item.edit.start, end: item.edit.end, reasonCode: "TRANSLATIONESE" }],
    } : {
      unitId: candidate.unitId,
      action: "retain",
      reasonCodes: [],
      riskFlags: [],
      additionalProtectedStrings: [],
      issueRanges: [],
    }),
  };
  const edit = {
    id: item.edit.id,
    unitId: unit.unitId,
    sourceDigest: manifest.sourceDigest,
    start: item.edit.start,
    end: item.edit.end,
    replacement: item.edit.replacement,
    actorId: actors.editing,
  };
  const editing = {
    schemaVersion: "1.0.0",
    actorId: actors.editing,
    sourceDigest: manifest.sourceDigest,
    selectionDigest: workProductDigest(selection),
    edits: [edit],
    candidateDigest: item.edit.candidateDigest,
  };
  validateSelectionWorkProduct(selection, manifest, item.sourceText);
  validateEditingWorkProduct(editing, { source: item.sourceText, manifest, selection });
  selections.push(selection);
  editings.push(editing);
}
await writeNewFile(path.join(regressionDir, "historical-selection-work-product.jsonl"), serializeJsonl(selections));
await writeNewFile(path.join(regressionDir, "historical-editing-work-product.jsonl"), serializeJsonl(editings));
console.log(JSON.stringify({ caseCount: input.length, sourceRuns: [...oldActors.keys()] }));

async function loadHistoricalActors() {
  const result = new Map();
  for (const run of [1, 2, 3]) {
    const directory = path.join(root, "evals", "runs", `run-${run}`);
    const selection = JSON.parse(await readFile(path.join(directory, "selection-meta.json"), "utf8"));
    const editing = JSON.parse(await readFile(path.join(directory, "editing-meta.json"), "utf8"));
    if (selection.actorId !== editing.selectorActorId || selection.actorId === editing.actorId) throw new Error(`HISTORICAL_ACTOR_BINDING_INVALID:${run}`);
    result.set(run, { selection: selection.actorId, editing: editing.actorId });
  }
  return result;
}

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
