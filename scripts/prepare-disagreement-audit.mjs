#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runs = [1, 2, 3];
const verificationInputs = await Promise.all(runs.map((run) => readJsonl(path.join(root, "evals", "runs", `run-${run}`, "verification-input.jsonl"))));
const verifications = await Promise.all(runs.map((run) => readJsonl(path.join(root, "evals", "runs", `run-${run}`, "verification.jsonl"))));
const count = verificationInputs[0].length;

for (const records of [...verificationInputs, ...verifications]) {
  if (records.length !== count) throw new Error("audit source count mismatch");
}

const auditInput = [];
for (let index = 0; index < count; index += 1) {
  const id = verificationInputs[0][index]?.id;
  if (!runs.every((_, runIndex) => verificationInputs[runIndex][index]?.id === id && verifications[runIndex][index]?.id === id)) {
    throw new Error(`audit source order mismatch at ${id}`);
  }
  const decisions = verifications.map((records) => records[index]);
  const decisionSet = new Set(decisions.map((record) => record.finalDecision));
  const hasUncertain = decisions.some((record) => [record.finalDecision, record.meaningPreservation, record.registerCompliance, record.terminologyJudgment].includes("uncertain"));
  if (decisionSet.size === 1 && !hasUncertain) continue;
  const source = verificationInputs[0][index];
  auditInput.push({
    id,
    suite: source.suite,
    genre: source.genre,
    context: source.context,
    sourceText: source.sourceText,
    userRequest: source.userRequest,
    register: source.register,
    meaningConstraints: source.meaningConstraints,
    protectedStrings: source.protectedStrings,
    candidates: Object.fromEntries(runs.map((run, runIndex) => [`run-${run}`, verificationInputs[runIndex][index].candidateText])),
    trigger: "verifier-disagreement-or-uncertainty",
  });
}

const auditDirectory = path.join(root, "evals", "audit");
await mkdir(auditDirectory, { recursive: true });
const text = `${auditInput.map((record) => JSON.stringify(record)).join("\n")}\n`;
await writeFile(path.join(auditDirectory, "input.jsonl"), text, "utf8");
await writeFile(path.join(auditDirectory, "input-meta.json"), `${JSON.stringify({
  schemaVersion: "1.0.0",
  caseCount: auditInput.length,
  sha256: createHash("sha256").update(text).digest("hex"),
  containsExpectedDecision: false,
  containsEditorRationale: false,
  containsPriorVerdicts: false,
}, null, 2)}\n`, "utf8");
console.log(`prepared disagreement audit input: ${auditInput.length} cases`);

async function readJsonl(file) {
  const text = await readFile(file, "utf8");
  return text.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}
