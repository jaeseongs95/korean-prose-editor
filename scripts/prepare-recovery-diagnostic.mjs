#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";
import { createSourceUnitManifest } from "../skills/korean-prose-editor/scripts/source-units.mjs";
import { parseJsonl, serializeJsonl, sha256, stableJson, writeNewFile } from "./lib/evaluation-cycle.mjs";
import { validateRecoveryContract, validateRecoveryCorpus } from "./lib/recovery-diagnostic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recoveryRoot = path.join(root, "evals", "cycles", "0.1.0-rc2", "recovery", "corpus-validity-v1");
const contractText = await readFile(path.join(recoveryRoot, "contract.json"), "utf8");
const inputText = await readFile(path.join(recoveryRoot, "input.jsonl"), "utf8");
const keyText = await readFile(path.join(recoveryRoot, "key.json"), "utf8");
const contract = JSON.parse(contractText);
const input = parseJsonl(inputText);
const key = JSON.parse(keyText);

validateRecoveryContract(contract);
validateRecoveryCorpus(input, key, contract);

const manifests = input.map((item) => createSourceUnitManifest(
  item.sourceText,
  extractProtectedSpans(item.sourceText, item.protectedStrings),
));
const bindings = {};
for (const relative of contract.freezeFiles) {
  bindings[relative] = sha256(await readFile(path.join(root, relative)));
}
bindings["evals/cycles/0.1.0-rc2/recovery/corpus-validity-v1/contract.json"] = sha256(contractText);
bindings["evals/cycles/0.1.0-rc2/recovery/corpus-validity-v1/input.jsonl"] = sha256(inputText);
bindings["evals/cycles/0.1.0-rc2/recovery/corpus-validity-v1/key.json"] = sha256(keyText);

const freeze = {
  schemaVersion: "1.0.0",
  recoveryId: contract.recoveryId,
  candidateCommit: contract.candidateCommit,
  authorizationDigest: contract.authorization.sha256,
  executionBudget: 1,
  comparableToPriorAttempts: false,
  bindings,
  frameDigest: sha256(stableJson({
    recoveryId: contract.recoveryId,
    candidateCommit: contract.candidateCommit,
    authorizationDigest: contract.authorization.sha256,
    authorities: contract.authorities,
    caseDesign: contract.caseDesign,
    thresholds: contract.thresholds,
    bindings,
  })),
};

await writeNewFile(path.join(recoveryRoot, "source-unit-manifest.jsonl"), serializeJsonl(manifests));
await writeNewFile(path.join(recoveryRoot, "FREEZE.json"), `${JSON.stringify(freeze, null, 2)}\n`);
console.log(JSON.stringify({ recoveryId: contract.recoveryId, caseCount: input.length, frameDigest: freeze.frameDigest }, null, 2));
