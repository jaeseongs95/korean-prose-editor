#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJsonl, serializeJsonl, sha256, writeNewFile } from "./lib/evaluation-cycle.mjs";
import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";
import { createSourceUnitManifest } from "../skills/korean-prose-editor/scripts/source-units.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const cycleDir = resolveCycleDir(options["cycle-dir"]);
const diagnosticDir = path.join(cycleDir, "diagnostic");
const outputDir = path.join(diagnosticDir, "semantic-regression");
const historical = parseJsonl(await readFile(path.join(diagnosticDir, "semantic-drift-regressions.jsonl"), "utf8"));
const oldInput = parseJsonl(await readFile(path.join(root, "evals", "runs", "input.jsonl"), "utf8"));
const sourceById = new Map(oldInput.map((item) => [item.id, item]));

if (historical.length !== 13) throw new Error("HISTORICAL_REGRESSION_COUNT_MISMATCH");
const input = historical.map((item) => {
  const source = sourceById.get(item.caseId);
  if (!source || source.sourceText !== item.sourceText || sha256(item.sourceText) !== item.sourceDigest || sha256(item.rejectedCandidateText) !== item.candidateDigest) {
    throw new Error(`HISTORICAL_REGRESSION_BINDING_MISMATCH:${item.regressionId}`);
  }
  const edit = minimalReplacement(item.sourceText, item.rejectedCandidateText);
  const reconstructed = `${item.sourceText.slice(0, edit.start)}${edit.replacement}${item.sourceText.slice(edit.end)}`;
  if (sha256(reconstructed) !== item.candidateDigest) throw new Error(`HISTORICAL_EDIT_RECONSTRUCTION_MISMATCH:${item.regressionId}`);
  return {
    schemaVersion: "1.0.0",
    id: item.regressionId,
    sourceCaseId: item.caseId,
    sourceText: item.sourceText,
    userRequest: source.userRequest,
    register: source.register,
    meaningConstraints: source.meaningConstraints,
    protectedStrings: source.protectedStrings,
    edit: {
      id: `offending-${item.regressionId}`,
      sourceDigest: item.sourceDigest,
      start: edit.start,
      end: edit.end,
      replacement: edit.replacement,
      candidateDigest: item.candidateDigest,
    },
  };
});
const key = historical.map((item) => ({
  id: item.regressionId,
  expectedDecision: "retain",
  historicalVerifierEvidence: item.verifierEvidence,
}));
const manifests = input.map((item) => createSourceUnitManifest(item.sourceText, extractProtectedSpans(item.sourceText, item.protectedStrings)));
await writeNewFile(path.join(outputDir, "input.jsonl"), serializeJsonl(input));
await writeNewFile(path.join(outputDir, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
await writeNewFile(path.join(outputDir, "source-unit-manifest.jsonl"), serializeJsonl(manifests));
console.log(JSON.stringify({ caseCount: input.length, outputDir: path.relative(root, outputDir).split(path.sep).join("/") }));

function minimalReplacement(source, candidate) {
  let start = 0;
  while (start < source.length && start < candidate.length && source[start] === candidate[start]) start += 1;
  let sourceEnd = source.length;
  let candidateEnd = candidate.length;
  while (sourceEnd > start && candidateEnd > start && source[sourceEnd - 1] === candidate[candidateEnd - 1]) {
    sourceEnd -= 1;
    candidateEnd -= 1;
  }
  return { start, end: sourceEnd, replacement: candidate.slice(start, candidateEnd) };
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
