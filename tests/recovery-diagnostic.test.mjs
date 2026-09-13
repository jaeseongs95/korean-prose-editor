import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJsonl } from "../scripts/lib/evaluation-cycle.mjs";
import { classifyRecovery, validateRecoveryContract, validateRecoveryCorpus } from "../scripts/lib/recovery-diagnostic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recoveryRoot = path.join(root, "evals", "cycles", "0.1.0-rc2", "recovery", "corpus-validity-v1");

test("recovery frame is separately authorized, balanced, and source-authoritative", async () => {
  const contract = validateRecoveryContract(JSON.parse(await readFile(path.join(recoveryRoot, "contract.json"), "utf8")));
  const input = parseJsonl(await readFile(path.join(recoveryRoot, "input.jsonl"), "utf8"));
  const key = JSON.parse(await readFile(path.join(recoveryRoot, "key.json"), "utf8"));
  assert.deepEqual(validateRecoveryCorpus(input, key, contract), { edit: 8, retain: 2, infeasible: 2 });
  assert.equal(contract.priorClosure.status, "invalid-corpus");
  assert.equal(contract.priorClosure.feasibleEditUpperBound, 7);
  assert.equal(contract.priorClosure.originalEditMinimum, 9);
  assert.equal(contract.comparableToPriorAttempts, false);
});

test("recovery contract rejects authorization and corpus mutations", async () => {
  const contract = JSON.parse(await readFile(path.join(recoveryRoot, "contract.json"), "utf8"));
  const input = parseJsonl(await readFile(path.join(recoveryRoot, "input.jsonl"), "utf8"));
  const key = JSON.parse(await readFile(path.join(recoveryRoot, "key.json"), "utf8"));
  assert.throws(() => validateRecoveryContract({ ...contract, authorization: { ...contract.authorization, statement: `${contract.authorization.statement}.` } }), /RECOVERY_AUTHORIZATION_DIGEST_MISMATCH/u);
  const brokenInput = input.map((item, index) => index === 0 ? { ...item, protectedStrings: ["없는 문자열"] } : item);
  assert.throws(() => validateRecoveryCorpus(brokenInput, key, contract), /RECOVERY_PROTECTED_STRING_INVALID/u);
  const brokenKey = key.map((item, index) => index === 0 ? { id: item.id, expectedDecision: "retain", rationale: item.rationale } : item);
  assert.throws(() => validateRecoveryCorpus(input, brokenKey, contract), /RECOVERY_KEY_BALANCE_MISMATCH/u);
});

test("recovery classification fails closed for an impossible corpus and enforces safety", () => {
  const thresholds = { editSuccessMinimum: 7, editDenominator: 8, restraintMinimum: 4, restraintDenominator: 4, majorMeaningChangesMaximum: 0, protectedFailuresMaximum: 0 };
  const passingCounts = { editSuccess: 7, editDenominator: 8, restraint: 4, restraintDenominator: 4, majorMeaningChanges: 0, protectedFailures: 0 };
  assert.deepEqual(classifyRecovery({ feasibleUpperBound: 6, counts: passingCounts, thresholds }), { status: "invalid-corpus", pass: false });
  assert.deepEqual(classifyRecovery({ feasibleUpperBound: 8, counts: passingCounts, thresholds }), { status: "passed-recovery", pass: true });
  assert.deepEqual(classifyRecovery({ feasibleUpperBound: 8, counts: { ...passingCounts, majorMeaningChanges: 1 }, thresholds }), { status: "failed-recovery", pass: false });
});
