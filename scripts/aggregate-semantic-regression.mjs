#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { evaluateStructuredCase, parseJsonl, sha256, stableJson, validateVerificationWorkProduct, writeNewFile } from "./lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const cycleDir = resolveCycleDir(options["cycle-dir"]);
const run = Number(options.run);
if (![1, 2, 3].includes(run)) throw new Error("run must be 1, 2, or 3");
const regressionDir = path.join(cycleDir, "diagnostic", "semantic-regression");
const runsRoot = resolveRunsRoot(regressionDir, options["runs-dir"]);
const runDir = path.join(runsRoot, `run-${run}`);
const inputText = await readFile(path.join(regressionDir, "input.jsonl"), "utf8");
const input = parseJsonl(inputText);
const key = JSON.parse(await readFile(path.join(regressionDir, "key.json"), "utf8"));
const manifests = parseJsonl(await readFile(path.join(regressionDir, "source-unit-manifest.jsonl"), "utf8"));
const selections = parseJsonl(await readFile(path.join(regressionDir, "historical-selection-work-product.jsonl"), "utf8"));
const editings = parseJsonl(await readFile(path.join(regressionDir, "historical-editing-work-product.jsonl"), "utf8"));
const verifications = parseJsonl(await readFile(path.join(runDir, "verification-work-product.jsonl"), "utf8"));
const rubricDigest = sha256(await readFile(path.join(root, "skills", "korean-prose-editor", "references", "verification-rubric.md")));
if ([input, key, manifests, selections, editings, verifications].some((records) => records.length !== 13)) throw new Error("SEMANTIC_REGRESSION_COUNT_MISMATCH");
const actors = new Set(verifications.map((item) => item.actorId));
if (actors.size !== 1) throw new Error("VERIFICATION_ACTOR_CHANGED_WITHIN_RUN");
const actorId = [...actors][0];
const keyById = new Map(key.map((item) => [item.id, item.expectedDecision]));
let retained = 0;
let restored = 0;
let majorMeaningChangeCount = 0;
for (let index = 0; index < input.length; index += 1) {
  const verification = validateVerificationWorkProduct(verifications[index], { manifest: manifests[index], editing: editings[index], rubricDigest });
  if (verification.globalDecision !== "continue" || verification.decisions.length !== 1 || verification.decisions[0].decision !== "retain") continue;
  retained += 1;
  if (verification.assessment.majorMeaningChange) majorMeaningChangeCount += 1;
  const result = evaluateStructuredCase({
    input: { ...input[index], id: input[index].id, suite: "historical-semantic-regression" },
    expectedDecision: keyById.get(input[index].id),
    manifest: manifests[index],
    selection: selections[index],
    editing: editings[index],
    verification,
    rubricDigest,
  });
  if (result.finalText === input[index].sourceText) restored += 1;
}
const meta = {
  schemaVersion: "2.0.0",
  run,
  role: "verification",
  actorId,
  caseCount: verifications.length,
  inputSha256: sha256(inputText),
  workProductSha256: sha256(stableJson(verifications)),
  status: "complete",
};
const metrics = {
  schemaVersion: "1.0.0",
  run,
  actorId,
  caseCount: input.length,
  editLevelRetainCount: retained,
  sourceRestoredCount: restored,
  majorMeaningChangeCount,
  gate: { pass: retained === 13 && restored === 13 },
};
await writeNewFile(path.join(runDir, "verification-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
await writeNewFile(path.join(runDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics, null, 2));

function resolveCycleDir(value) {
  if (!value) throw new Error("--cycle-dir is required");
  const cyclesRoot = path.resolve(root, "evals", "cycles");
  const resolved = path.resolve(root, value);
  if (resolved === cyclesRoot || !resolved.startsWith(`${cyclesRoot}${path.sep}`)) throw new Error("cycle directory must be a child of evals/cycles");
  return resolved;
}

function resolveRunsRoot(regressionDir, value) {
  const resolved = path.resolve(regressionDir, value ?? "runs");
  if (resolved === regressionDir || !resolved.startsWith(`${regressionDir}${path.sep}`)) throw new Error("runs directory must be below the semantic regression directory");
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
