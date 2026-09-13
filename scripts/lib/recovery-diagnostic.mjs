import { sha256, stableJson } from "./evaluation-cycle.mjs";

export const RECOVERY_ID = "0.1.0-rc2-corpus-validity-v1";

export function validateRecoveryContract(value) {
  if (value.schemaVersion !== "1.0.0" || value.recoveryId !== RECOVERY_ID || value.executionBudget !== 1 || value.comparableToPriorAttempts !== false) {
    throw new Error("RECOVERY_CONTRACT_IDENTITY_MISMATCH");
  }
  if (value.authorization?.sha256 !== sha256(value.authorization?.statement ?? "")) throw new Error("RECOVERY_AUTHORIZATION_DIGEST_MISMATCH");
  if (!/^[a-f0-9]{40}$/u.test(value.candidateCommit ?? "")) throw new Error("RECOVERY_CANDIDATE_COMMIT_INVALID");
  if (stableJson(value.authorities) !== stableJson({ semanticSource: "sourceText-and-protectedStrings", meaningConstraints: "derived-conservative-check", conflictDecision: "infeasible" })) {
    throw new Error("RECOVERY_AUTHORITY_CHANGED");
  }
  if (stableJson(value.caseDesign) !== stableJson({ caseCount: 12, edit: 8, retain: 2, infeasible: 2 })) throw new Error("RECOVERY_CASE_DESIGN_CHANGED");
  if (stableJson(value.thresholds) !== stableJson({ editSuccessMinimum: 7, editDenominator: 8, restraintMinimum: 4, restraintDenominator: 4, majorMeaningChangesMaximum: 0, protectedFailuresMaximum: 0 })) {
    throw new Error("RECOVERY_THRESHOLDS_CHANGED");
  }
  if (!Array.isArray(value.freezeFiles) || value.freezeFiles.length === 0 || new Set(value.freezeFiles).size !== value.freezeFiles.length) throw new Error("RECOVERY_FREEZE_FILES_INVALID");
  return value;
}

export function validateRecoveryCorpus(cases, answerKey, contract) {
  if (cases.length !== contract.caseDesign.caseCount || answerKey.length !== cases.length) throw new Error("RECOVERY_CASE_COUNT_MISMATCH");
  const ids = cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length || stableJson(ids) !== stableJson(answerKey.map((item) => item.id))) throw new Error("RECOVERY_KEY_ORDER_MISMATCH");
  const counts = { edit: 0, retain: 0, infeasible: 0 };
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const keyed = answerKey[index];
    if (!item || typeof item.sourceText !== "string" || item.sourceText.length === 0 || !Array.isArray(item.meaningConstraints) || item.meaningConstraints.length === 0 || !Array.isArray(item.protectedStrings)) throw new Error(`RECOVERY_INPUT_INVALID:${item?.id ?? index}`);
    if (!Object.hasOwn(counts, keyed.expectedDecision) || typeof keyed.rationale !== "string" || keyed.rationale.length === 0) throw new Error(`RECOVERY_KEY_INVALID:${item.id}`);
    counts[keyed.expectedDecision] += 1;
    for (const protectedString of item.protectedStrings) {
      if (typeof protectedString !== "string" || protectedString.length === 0 || !item.sourceText.includes(protectedString)) throw new Error(`RECOVERY_PROTECTED_STRING_INVALID:${item.id}`);
    }
    if (keyed.expectedDecision === "edit" && (typeof keyed.exampleExpectedText !== "string" || keyed.exampleExpectedText === item.sourceText)) throw new Error(`RECOVERY_EDIT_EXAMPLE_INVALID:${item.id}`);
    if (keyed.expectedDecision !== "edit" && Object.hasOwn(keyed, "exampleExpectedText")) throw new Error(`RECOVERY_CONTROL_EXAMPLE_FORBIDDEN:${item.id}`);
  }
  if (stableJson(counts) !== stableJson({ edit: 8, retain: 2, infeasible: 2 })) throw new Error("RECOVERY_KEY_BALANCE_MISMATCH");
  if (counts.edit < contract.thresholds.editSuccessMinimum) throw new Error("RECOVERY_INVALID_CORPUS_UPPER_BOUND");
  return counts;
}

export function classifyRecovery({ feasibleUpperBound, counts, thresholds }) {
  if (feasibleUpperBound < thresholds.editSuccessMinimum) return { status: "invalid-corpus", pass: false };
  const pass = counts.editSuccess >= thresholds.editSuccessMinimum &&
    counts.editDenominator === thresholds.editDenominator &&
    counts.restraint >= thresholds.restraintMinimum &&
    counts.restraintDenominator === thresholds.restraintDenominator &&
    counts.majorMeaningChanges <= thresholds.majorMeaningChangesMaximum &&
    counts.protectedFailures <= thresholds.protectedFailuresMaximum;
  return { status: pass ? "passed-recovery" : "failed-recovery", pass };
}
