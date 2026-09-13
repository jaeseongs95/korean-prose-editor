#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  RUN_BUDGET,
  aggregateStructuredRun,
  digestFile,
  parseJsonl,
  serializeJsonl,
  sha256,
  validateRunMetadata,
  writeNewFile,
} from "./lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const cycleDir = resolveCycleDir(options["cycle-dir"]);
const run = Number(options.run);
if (!Number.isInteger(run) || run < 1 || run > RUN_BUDGET) throw new Error("run must be 1, 2, or 3");

const freeze = await readJson(path.join(cycleDir, "FREEZE.json"));
const manifest = await readJson(path.join(cycleDir, "manifest.json"));
if (freeze.runCount !== RUN_BUDGET || manifest.runCount !== RUN_BUDGET) throw new Error("CYCLE_RUN_BUDGET_MUST_BE_THREE");
if (manifest.freezeSha256 !== sha256(`${JSON.stringify(freeze, null, 2)}\n`)) throw new Error("FREEZE_DIGEST_MISMATCH");
await verifyFrozenBindings(freeze.bindings);

const inputText = await readFile(path.join(cycleDir, "input.jsonl"), "utf8");
const keyText = await readFile(path.join(cycleDir, "key.json"), "utf8");
if (sha256(inputText) !== manifest.inputSha256 || sha256(keyText) !== manifest.keySha256) throw new Error("EVALUATION_INPUT_DIGEST_MISMATCH");
const runDir = path.join(cycleDir, "runs", `run-${run}`);
const diagnosticInventory = await readJson(path.resolve(root, "evals", "cycles", "0.1.0-rc2", "diagnostic", "inventory.json"));
const workProducts = {
  selection: parseJsonl(await readFile(path.join(runDir, "selection-work-product.jsonl"), "utf8")),
  editing: parseJsonl(await readFile(path.join(runDir, "editing-work-product.jsonl"), "utf8")),
  verification: parseJsonl(await readFile(path.join(runDir, "verification-work-product.jsonl"), "utf8")),
};
validateRunMetadata({
  run,
  inputSha256: manifest.inputSha256,
  products: workProducts,
  metas: {
    selection: await readJson(path.join(runDir, "selection-meta.json")),
    editing: await readJson(path.join(runDir, "editing-meta.json")),
    verification: await readJson(path.join(runDir, "verification-meta.json")),
  },
});
const { finals, metrics } = aggregateStructuredRun({
  run,
  input: parseJsonl(inputText),
  key: JSON.parse(keyText),
  manifests: parseJsonl(await readFile(path.join(runDir, "source-unit-manifest.jsonl"), "utf8")),
  selections: workProducts.selection,
  editings: workProducts.editing,
  verifications: workProducts.verification,
  rubricDigest: freeze.bindings.policies["skills/korean-prose-editor/references/verification-rubric.md"],
  thresholds: manifest.thresholds.release,
  diagnosticInventory: hasDiagnosticCases(parseJsonl(inputText), diagnosticInventory) ? diagnosticInventory : null,
  candidateCommit: manifest.candidateCommit,
});

await writeNewFile(path.join(runDir, "final.jsonl"), serializeJsonl(finals));
await writeNewFile(path.join(runDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics, null, 2));

async function verifyFrozenBindings(bindings) {
  if (sha256(bindings.candidateCommit.value) !== bindings.candidateCommit.sha256) throw new Error("CANDIDATE_COMMIT_DIGEST_MISMATCH");
  for (const [file, digest] of Object.entries({ ...bindings.policies, ...bindings.privateSchemas })) {
    if (await digestFile(path.resolve(root, file)) !== digest) throw new Error(`FROZEN_BINDING_CHANGED:${file}`);
  }
  for (const binding of [bindings.corpus, bindings.holdout, bindings.protocol, bindings.thresholds]) {
    if (await digestFile(path.resolve(root, binding.path)) !== binding.sha256) throw new Error(`FROZEN_BINDING_CHANGED:${binding.path}`);
  }
}

function hasDiagnosticCases(input, inventory) {
  const ids = new Set(input.map((item) => item.id));
  return [...inventory.editCases, ...inventory.controlCases].every((item) => ids.has(item.caseId));
}

function resolveCycleDir(value) {
  if (!value) throw new Error("--cycle-dir is required");
  const cyclesRoot = path.resolve(root, "evals", "cycles");
  const resolved = path.resolve(root, value);
  if (resolved === cyclesRoot || !resolved.startsWith(`${cyclesRoot}${path.sep}`)) throw new Error("cycle directory must be a child of evals/cycles");
  return resolved;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--") || !arguments_[index + 1] || arguments_[index + 1].startsWith("--")) throw new Error(`invalid argument: ${argument}`);
    options[argument.slice(2)] = arguments_[index + 1];
    index += 1;
  }
  return options;
}
