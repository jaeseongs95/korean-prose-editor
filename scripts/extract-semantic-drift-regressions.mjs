#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJsonl, serializeJsonl, sha256, writeNewFile } from "./lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputArgument = valueAfter("--output");
if (!outputArgument) throw new Error("--output is required");
const output = path.resolve(root, outputArgument);

const input = parseJsonl(await readFile(path.join(root, "evals", "runs", "input.jsonl"), "utf8"));
const key = JSON.parse(await readFile(path.join(root, "evals", "runs", "key.json"), "utf8"));
const expectedById = new Map(key.map((item) => [item.id, item.expectedDecision]));
const records = [];
for (let run = 1; run <= 3; run += 1) {
  const runDir = path.join(root, "evals", "runs", `run-${run}`);
  const candidates = parseJsonl(await readFile(path.join(runDir, "candidate.jsonl"), "utf8"));
  const verification = parseJsonl(await readFile(path.join(runDir, "verification.jsonl"), "utf8"));
  if (candidates.length !== input.length || verification.length !== input.length) throw new Error(`HISTORICAL_RUN_COUNT_MISMATCH:${run}`);
  input.forEach((item, index) => {
    const candidate = candidates[index];
    const verified = verification[index];
    if (candidate.id !== item.id || verified.id !== item.id) throw new Error(`HISTORICAL_RUN_ORDER_MISMATCH:${run}:${item.id}`);
    if (expectedById.get(item.id) !== "edit" || candidate.selectionAction !== "edit" || candidate.candidateText === item.sourceText || verified.finalDecision === "accept") return;
    records.push({
      regressionId: `historical-run-${run}:${item.id}`,
      run,
      caseId: item.id,
      sourceDigest: sha256(item.sourceText),
      candidateDigest: sha256(candidate.candidateText),
      sourceText: item.sourceText,
      rejectedCandidateText: candidate.candidateText,
      verifierEvidence: {
        finalDecision: verified.finalDecision,
        meaningPreservation: verified.meaningPreservation,
        majorMeaningChange: verified.majorMeaningChange,
        registerCompliance: verified.registerCompliance,
        protectedStrings: verified.protectedStrings,
        terminologyJudgment: verified.terminologyJudgment,
        pairPreference: verified.pairPreference,
        warningCodes: verified.warningCodes,
      },
      expectedUse: "negative-semantic-drift-regression",
    });
  });
}

await writeNewFile(output, serializeJsonl(records));
console.log(`extracted ${records.length} historically rejected changed candidates`);

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}
