#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { RUN_BUDGET, writeNewFile } from "./lib/evaluation-cycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cycleArgument = valueAfter("--cycle-dir");
  if (!cycleArgument) throw new Error("--cycle-dir is required");
  const cycleDir = resolveCycleDir(root, cycleArgument);
  const result = await summarizeEvaluationCycle({ cycleDir });
  await writeNewFile(path.join(cycleDir, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

export async function summarizeEvaluationCycle({ cycleDir }) {
  const manifest = JSON.parse(await readFile(path.join(cycleDir, "manifest.json"), "utf8"));
  if (manifest.runCount !== RUN_BUDGET) throw new Error("CYCLE_RUN_BUDGET_MUST_BE_THREE");
  const runsRoot = path.join(cycleDir, "runs");
  const presentRuns = (await readdir(runsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^run-[0-9]+$/u.test(entry.name))
    .map((entry) => Number(entry.name.slice(4)))
    .sort((left, right) => left - right);
  if (JSON.stringify(presentRuns) !== JSON.stringify([1, 2, 3])) throw new Error("EXACTLY_THREE_RUN_DIRECTORIES_REQUIRED");

  const runSummaries = [];
  const actorIds = [];
  for (let run = 1; run <= RUN_BUDGET; run += 1) {
    const runDir = path.join(runsRoot, `run-${run}`);
    const metrics = JSON.parse(await readFile(path.join(runDir, "metrics.json"), "utf8"));
    if (metrics.run !== run || metrics.candidateCommit !== manifest.candidateCommit) throw new Error(`RUN_METRICS_BINDING_MISMATCH:${run}`);
    const roleActors = [];
    for (const role of ["selection", "editing", "verification"]) {
      const meta = JSON.parse(await readFile(path.join(runDir, `${role}-meta.json`), "utf8"));
      if (meta.run !== run || meta.role !== role || meta.actorId !== metrics.actorIds?.[["selection", "editing", "verification"].indexOf(role)]) throw new Error(`RUN_ACTOR_BINDING_MISMATCH:${run}:${role}`);
      roleActors.push(meta.actorId);
      actorIds.push(meta.actorId);
    }
    runSummaries.push({ run, actorIds: roleActors, releasePass: metrics.gate?.releasePass === true, diagnosticPass: metrics.gate?.diagnosticPass ?? null });
  }
  const globalActorReuse = new Set(actorIds).size !== RUN_BUDGET * 3;
  const releasePass = runSummaries.every((item) => item.releasePass);
  const diagnosticPass = runSummaries.every((item) => item.diagnosticPass !== false);
  const pass = !globalActorReuse && releasePass && diagnosticPass;
  const reasonCodes = [];
  if (globalActorReuse) reasonCodes.push("GLOBAL_ROLE_ACTOR_REUSE");
  if (!releasePass) reasonCodes.push("RUN_RELEASE_GATE_FAILED");
  if (!diagnosticPass) reasonCodes.push("RUN_DIAGNOSTIC_GATE_FAILED");
  return {
    schemaVersion: "2.0.0",
    cycleId: manifest.cycleId,
    candidateCommit: manifest.candidateCommit,
    runCount: RUN_BUDGET,
    uniqueActorCount: new Set(actorIds).size,
    runSummaries,
    gate: { pass, releasePass, diagnosticPass, globalActorReuse },
    releaseDecision: pass ? "pass" : "fail",
    reasonCodes,
  };
}

function resolveCycleDir(repositoryRoot, value) {
  const cyclesRoot = path.resolve(repositoryRoot, "evals", "cycles");
  const resolved = path.resolve(repositoryRoot, value);
  if (resolved === cyclesRoot || !resolved.startsWith(`${cyclesRoot}${path.sep}`)) throw new Error("cycle directory must be a child of evals/cycles");
  return resolved;
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}
