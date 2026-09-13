#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  RUN_BUDGET,
  assertReleaseThresholds,
  digestFile,
  parseJsonl,
  serializeJsonl,
  sha256,
  writeNewFile,
} from "./lib/evaluation-cycle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = await prepareEvaluationCycle({
    repositoryRoot,
    cycleDir: options["cycle-dir"],
    candidateCommit: options["candidate-commit"],
    holdoutFile: options.holdout,
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function prepareEvaluationCycle({ repositoryRoot: root, cycleDir, candidateCommit, holdoutFile }) {
  const resolvedCycleDir = resolveCycleDir(root, cycleDir);
  if (!/^[a-f0-9]{40}$/u.test(candidateCommit ?? "")) throw new Error("candidate commit must be a full lowercase 40-character SHA");
  if (!holdoutFile) throw new Error("--holdout is required; do not reuse the historical holdout");

  const definitionFile = path.join(resolvedCycleDir, "cycle-definition.json");
  const definition = JSON.parse(await readFile(definitionFile, "utf8"));
  if (definition.runCount !== RUN_BUDGET) throw new Error("CYCLE_RUN_BUDGET_MUST_BE_THREE");
  const paths = definition.paths;
  const corpusFile = resolveRepositoryPath(root, paths.corpus);
  const legacyKeyFile = resolveRepositoryPath(root, paths.legacyKey);
  const protocolFile = resolveRepositoryPath(root, paths.protocol);
  const thresholdsFile = resolveRepositoryPath(root, paths.thresholds);
  const policies = paths.policies.map((file) => resolveRepositoryPath(root, file));
  const privateSchemas = paths.privateSchemas.map((file) => resolveRepositoryPath(root, file));
  const resolvedHoldoutFile = path.resolve(root, holdoutFile);
  if (resolvedHoldoutFile !== path.join(resolvedCycleDir, "holdout", "cases.json")) throw new Error("fresh holdout must be cycle-dir/holdout/cases.json");

  const corpusText = await readFile(corpusFile, "utf8");
  const corpus = parseJsonl(corpusText);
  const legacyKey = new Map(parseJsonl(await readFile(legacyKeyFile, "utf8")).map((item) => [item.id, item]));
  const holdoutText = await readFile(resolvedHoldoutFile, "utf8");
  const holdout = JSON.parse(holdoutText);
  validateFreshHoldout(holdout);
  const thresholdsText = await readFile(thresholdsFile, "utf8");
  const thresholds = JSON.parse(thresholdsText);
  assertReleaseThresholds(thresholds.release);
  if (thresholds.diagnostic.editRecallMinimum !== 15 || thresholds.diagnostic.restraintMinimum !== 18) throw new Error("DIAGNOSTIC_THRESHOLDS_CHANGED");

  const oldFreeze = JSON.parse(await readFile(path.join(root, "evals", "FREEZE.json"), "utf8"));
  if (sha256(corpusText) !== oldFreeze.bindings?.legacyCorpusSha256) throw new Error("LEGACY_CORPUS_DIGEST_CHANGED");
  if (JSON.stringify(thresholds.release) !== JSON.stringify(oldFreeze.thresholds)) throw new Error("ORIGINAL_RELEASE_THRESHOLDS_CHANGED");

  const input = [
    ...corpus.map((item) => ({
      id: `legacy:${item.id}`,
      suite: "legacy-100",
      genre: item.genre,
      context: item.context,
      sourceText: item.input,
      userRequest: "원문의 격식과 의미를 유지하면서 필요한 부분만 자연스럽게 다듬어 주세요.",
      register: item.register,
      meaningConstraints: item.meaning_constraints,
      protectedStrings: item.protected_strings,
    })),
    ...holdout.map((item, index) => ({
      id: `holdout:F${String(index + 1).padStart(3, "0")}`,
      suite: "holdout-30",
      genre: item.genre,
      context: item.context ?? null,
      sourceText: item.sourceText,
      userRequest: item.userRequest,
      register: item.register,
      meaningConstraints: item.meaningConstraints,
      protectedStrings: item.protectedStrings,
    })),
  ];
  const key = [
    ...corpus.map((item) => ({ id: `legacy:${item.id}`, expectedDecision: legacyKey.get(item.id)?.recommendedAction ?? "unknown" })),
    ...holdout.map((item, index) => ({ id: `holdout:F${String(index + 1).padStart(3, "0")}`, privateId: item.id, expectedDecision: item.expectedDecision })),
  ];
  if (corpus.length !== 100 || input.length !== 130 || new Set(input.map((item) => item.id)).size !== 130) throw new Error("EVALUATION_CASE_COUNT_MISMATCH");
  if (key.some((item) => !["edit", "retain", "defer"].includes(item.expectedDecision))) throw new Error("EVALUATION_KEY_INCOMPLETE");

  const inputText = serializeJsonl(input);
  const keyText = `${JSON.stringify(key, null, 2)}\n`;
  const bindings = {
    candidateCommit: { value: candidateCommit, sha256: sha256(candidateCommit) },
    policies: await digestMap(root, policies),
    privateSchemas: await digestMap(root, privateSchemas),
    corpus: { path: repositoryRelative(root, corpusFile), sha256: sha256(corpusText) },
    holdout: { path: repositoryRelative(root, resolvedHoldoutFile), sha256: sha256(holdoutText) },
    protocol: { path: repositoryRelative(root, protocolFile), sha256: await digestFile(protocolFile) },
    thresholds: { path: repositoryRelative(root, thresholdsFile), sha256: sha256(thresholdsText) },
  };
  const freeze = {
    schemaVersion: "2.0.0",
    status: "frozen-before-evaluation",
    cycleId: definition.cycleId,
    runCount: RUN_BUDGET,
    bindings,
  };
  const manifest = {
    schemaVersion: "2.0.0",
    cycleId: definition.cycleId,
    candidateCommit,
    caseCount: input.length,
    inputSha256: sha256(inputText),
    keySha256: sha256(keyText),
    freezeSha256: sha256(`${JSON.stringify(freeze, null, 2)}\n`),
    runCount: RUN_BUDGET,
    thresholds,
    workProductOrderBinding: "Each work-product JSONL line corresponds to the input.jsonl line at the same zero-based index.",
  };

  const targets = [
    [path.join(resolvedCycleDir, "FREEZE.json"), `${JSON.stringify(freeze, null, 2)}\n`],
    [path.join(resolvedCycleDir, "input.jsonl"), inputText],
    [path.join(resolvedCycleDir, "key.json"), keyText],
    [path.join(resolvedCycleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`],
  ];
  for (const [file] of targets) await assertMissing(file);
  for (const [file, contents] of targets) await writeNewFile(file, contents);
  return { cycleId: definition.cycleId, caseCount: input.length, runCount: RUN_BUDGET, inputSha256: manifest.inputSha256 };
}

export function validateFreshHoldout(holdout) {
  if (!Array.isArray(holdout) || holdout.length !== 30) throw new Error("FRESH_HOLDOUT_MUST_HAVE_30_CASES");
  const ids = new Set();
  const decisions = { edit: 0, retain: 0, defer: 0 };
  for (const item of holdout) {
    const keys = ["id", "genre", "context", "sourceText", "userRequest", "register", "meaningConstraints", "protectedStrings", "expectedDecision"].sort();
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().some((key, index) => key !== keys[index]) || Object.keys(item).length !== keys.length) throw new Error("FRESH_HOLDOUT_CASE_FIELDS_MISMATCH");
    if (typeof item.id !== "string" || item.id.length === 0 || ids.has(item.id)) throw new Error("FRESH_HOLDOUT_ID_INVALID");
    if (typeof item.genre !== "string" || typeof item.sourceText !== "string" || typeof item.userRequest !== "string" || typeof item.register !== "string") throw new Error("FRESH_HOLDOUT_TEXT_FIELD_INVALID");
    if (item.context !== null && typeof item.context !== "string") throw new Error("FRESH_HOLDOUT_CONTEXT_INVALID");
    if (!Array.isArray(item.meaningConstraints) || !Array.isArray(item.protectedStrings)) throw new Error("FRESH_HOLDOUT_ARRAY_FIELD_INVALID");
    if (!Object.hasOwn(decisions, item.expectedDecision)) throw new Error("FRESH_HOLDOUT_DECISION_INVALID");
    decisions[item.expectedDecision] += 1;
    ids.add(item.id);
  }
  if (Object.values(decisions).some((count) => count !== 10)) throw new Error("FRESH_HOLDOUT_MUST_BALANCE_10_10_10");
}

function resolveCycleDir(root, value) {
  if (!value) throw new Error("--cycle-dir is required");
  const cyclesRoot = path.resolve(root, "evals", "cycles");
  const resolved = path.resolve(root, value);
  if (resolved === cyclesRoot || !resolved.startsWith(`${cyclesRoot}${path.sep}`)) throw new Error("cycle directory must be a child of evals/cycles");
  return resolved;
}

function resolveRepositoryPath(root, value) {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`PATH_OUTSIDE_REPOSITORY:${value}`);
  return resolved;
}

async function digestMap(root, files) {
  return Object.fromEntries(await Promise.all(files.map(async (file) => [repositoryRelative(root, file), await digestFile(file)])));
}

function repositoryRelative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function assertMissing(file) {
  try {
    await access(file);
    throw new Error(`REFUSE_OVERWRITE:${file}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
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
