#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "evals", "runs");

const legacy = parseJsonl(await readFile(path.join(root, "evals", "legacy", "translationese-100", "corpus.jsonl"), "utf8"));
const legacyKey = new Map(parseJsonl(await readFile(path.join(root, "evals", "legacy", "translationese-100", "validation-baseline.jsonl"), "utf8")).map((item) => [item.id, item]));
const holdout = JSON.parse(await readFile(path.join(root, "evals", "holdout", "cases.json"), "utf8"));
const freeze = JSON.parse(await readFile(path.join(root, "evals", "FREEZE.json"), "utf8"));
const candidateCommit = process.argv.slice(2).find((argument) => argument !== "--") ?? null;

const input = [
  ...legacy.map((item) => ({
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
    id: `holdout:H${String(index + 1).padStart(3, "0")}`,
    suite: "holdout-30",
    genre: "holdout",
    context: null,
    sourceText: item.sourceText,
    userRequest: item.userRequest,
    register: "preserve",
    meaningConstraints: [],
    protectedStrings: item.protectedStrings,
  })),
];

const key = [
  ...legacy.map((item) => ({ id: `legacy:${item.id}`, expectedDecision: legacyKey.get(item.id)?.recommendedAction ?? "unknown" })),
  ...holdout.map((item, index) => ({
    id: `holdout:H${String(index + 1).padStart(3, "0")}`,
    sourceId: item.id,
    category: item.category,
    expectedDecision: item.expectedDecision,
  })),
];

if (input.length !== 130 || new Set(input.map((item) => item.id)).size !== 130) throw new Error("evaluation input must contain 130 unique cases");
if (key.some((item) => item.expectedDecision === "unknown")) throw new Error("legacy evaluation key is incomplete");

const inputText = `${input.map((item) => JSON.stringify(item)).join("\n")}\n`;
const keyText = `${JSON.stringify(key, null, 2)}\n`;
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "input.jsonl"), inputText, "utf8");
await writeFile(path.join(outputDir, "key.json"), keyText, "utf8");
await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify({
  schemaVersion: "1.0.0",
  candidateCommit,
  caseCount: input.length,
  inputSha256: sha256(inputText),
  keySha256: sha256(keyText),
  frozenBindings: freeze.bindings,
  runCount: freeze.runCount,
  thresholds: freeze.thresholds,
}, null, 2)}\n`, "utf8");

console.log(`prepared ${input.length} cases; input ${sha256(inputText)}`);

function parseJsonl(text) {
  return text.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
