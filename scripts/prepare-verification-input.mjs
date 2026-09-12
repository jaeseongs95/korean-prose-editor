#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = Number(process.argv.slice(2).find((argument) => argument !== "--"));
if (![1, 2, 3].includes(run)) throw new Error("run must be 1, 2, or 3");

const input = parseJsonl(await readFile(path.join(root, "evals", "runs", "input.jsonl"), "utf8"));
const runDir = path.join(root, "evals", "runs", `run-${run}`);
const candidate = parseJsonl(await readFile(path.join(runDir, "candidate.jsonl"), "utf8"));
if (candidate.length !== input.length) throw new Error("candidate count mismatch");

const sanitized = input.map((item, index) => {
  const candidateItem = candidate[index];
  if (candidateItem.id !== item.id) throw new Error(`candidate order mismatch at ${item.id}`);
  return {
    id: item.id,
    suite: item.suite,
    genre: item.genre,
    context: item.context,
    sourceText: item.sourceText,
    candidateText: candidateItem.candidateText,
    userRequest: item.userRequest,
    register: item.register,
    meaningConstraints: item.meaningConstraints,
    protectedStrings: item.protectedStrings,
  };
});

const text = `${sanitized.map((item) => JSON.stringify(item)).join("\n")}\n`;
await writeFile(path.join(runDir, "verification-input.jsonl"), text, "utf8");
await writeFile(path.join(runDir, "verification-input-meta.json"), `${JSON.stringify({
  run,
  caseCount: sanitized.length,
  sha256: createHash("sha256").update(text).digest("hex"),
  containsExpectedDecision: false,
  containsEditorRationale: false,
  status: "frozen",
}, null, 2)}\n`, "utf8");
console.log(`prepared verification input for run ${run}: ${sanitized.length} cases`);

function parseJsonl(text) {
  return text.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}
