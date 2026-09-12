#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "skills", "korean-prose-editor");
const required = [
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "pnpm-lock.yaml",
  "skills/korean-prose-editor/SKILL.md",
  "skills/korean-prose-editor/agents/openai.yaml",
  "skills/korean-prose-editor/integration/skill-descriptor.json",
  "skills/korean-prose-editor/integration/skill-descriptor.v2.schema.json",
  "skills/korean-prose-editor/integration/provider-result.v1.schema.json",
  "skills/korean-prose-editor/contracts/edit-decision-set.v1.schema.json",
  "skills/korean-prose-editor/contracts/edit-candidate.v1.schema.json",
  "skills/korean-prose-editor/contracts/edit-verification-report.v1.schema.json",
  "skills/korean-prose-editor/contracts/final-text-receipt.v1.schema.json",
  "skills/korean-prose-editor/contracts/provider-plan.schema.json",
  "skills/korean-prose-editor/contracts/protected-manifest.schema.json",
  "skills/korean-prose-editor/contracts/finalization-request.schema.json",
  "skills/korean-prose-editor/contracts/receipt.schema.json",
  "evals/legacy/BEHAVIOR_CASES.md",
  "evals/legacy/EVALUATION_PROTOCOL.md",
  "evals/legacy/translationese-100/corpus.jsonl",
  "evals/legacy/translationese-100/EVALUATION_PLAN.md",
  "evals/legacy/translationese-100/validation-baseline.jsonl",
  "evals/legacy/failures/ROOT_CAUSE_1.0.2.md",
  "evals/legacy/failures/cases-2.0.3.json",
  "evals/legacy/provenance.json",
  "evals/FREEZE.json",
  "evals/EVALUATION_PROTOCOL.md",
  "evals/holdout/cases.json",
];

/** @type {string[]} */
const failures = [];
for (const relative of required) {
  try {
    await access(path.join(root, relative), constants.R_OK);
  } catch {
    failures.push(`missing ${relative}`);
  }
}

const packageJson = await readJson("package.json");
expect(packageJson.name === "korean-prose-editor", "package name must be korean-prose-editor");
expect(packageJson.version === "0.1.0", "package version must be 0.1.0");
expect(packageJson.engines?.node === ">=22", "Node engine must be >=22");
expect(packageJson.packageManager === "pnpm@11.19.0", "packageManager must be pnpm@11.19.0");
expect(packageJson.license === "MIT", "package license must be MIT");

const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
expect(/^---\n[\s\S]+?\n---\n/.test(skill), "SKILL.md must have YAML frontmatter");
expect(/^name: korean-prose-editor$/m.test(skill), "SKILL name mismatch");
expect(/^[ ]{2}version: 0\.1\.0$/m.test(skill), "SKILL version mismatch");
expect(!/\[TODO(?::|\])/i.test(skill), "SKILL.md contains a TODO placeholder");

const openaiYaml = await readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
expect(openaiYaml.includes("$korean-prose-editor"), "default_prompt must mention $korean-prose-editor");

const descriptor = await readJson("skills/korean-prose-editor/integration/skill-descriptor.json");
const descriptorSchema = await readJson("skills/korean-prose-editor/integration/skill-descriptor.v2.schema.json");
const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
const validateDescriptor = ajv.compile(descriptorSchema);
expect(validateDescriptor(descriptor), `descriptor schema validation failed: ${ajv.errorsText(validateDescriptor.errors)}`);
expect(descriptor.schemaVersion === "2.0.0", "descriptor schema version mismatch");
expect(descriptor.skillId === packageJson.name && descriptor.version === packageJson.version, "descriptor identity mismatch");
expect(Array.isArray(descriptor.providers) && descriptor.providers.length === 4, "descriptor must declare four providers");
expect(JSON.stringify(descriptor.providers?.map((provider) => provider.phaseOrder)) === JSON.stringify([50, 55, 60, 65]), "provider phase order mismatch");
expect(JSON.stringify(descriptor.providers?.map((provider) => provider.producedArtifacts?.[0])) === JSON.stringify(["edit-decision-set", "edit-candidate", "edit-verification-report", "final-text-receipt"]), "provider artifacts mismatch");
for (const [index, provider] of (descriptor.providers ?? []).entries()) {
  for (const field of ["capabilities", "executionClass", "phase", "phaseOrder", "requiredInputArtifacts", "inputBindings", "producedArtifacts", "outputSchema", "resultSchema", "stateMapping", "selectionCriteria", "preconditions", "failureHandling", "gate", "receiptPolicy"]) {
    expect(Object.hasOwn(provider, field), `provider ${index} missing ${field}`);
  }
  expect(provider.receiptPolicy?.mode === "reference-only", `provider ${index} receipt policy mismatch`);
  if (index < 3) {
    expect(provider.receiptPolicy?.actorIdPointer === "/output/actorId" && provider.receiptPolicy?.uniqueness === "run", `provider ${index} actor receipt policy mismatch`);
  } else {
    expect(!Object.hasOwn(provider.receiptPolicy ?? {}, "actorIdPointer") && !Object.hasOwn(provider.receiptPolicy ?? {}, "uniqueness"), "finalizer must not claim a language actor");
    expect(provider.receiptPolicy?.actorIdsPointer === "/output/actorIds" && provider.receiptPolicy?.actorIdsMatch === "prior-policy-actors", "finalizer must bind prior policy actors in order");
  }
}

for (const schemaName of ["provider-plan", "protected-manifest", "finalization-request", "receipt", "edit-decision-set.v1", "edit-candidate.v1", "edit-verification-report.v1", "final-text-receipt.v1"]) {
  const schema = await readJson(`skills/korean-prose-editor/contracts/${schemaName}.schema.json`);
  expect(schema.$schema === "https://json-schema.org/draft/2020-12/schema", `${schemaName} schema draft mismatch`);
  expect(schema.type === "object" && schema.additionalProperties === false, `${schemaName} schema must close its root object`);
  if (!schema.$ref && !JSON.stringify(schema).includes('"$ref":"provider-plan.schema.json"')) ajv.compile(schema);
}
const planSchema = await readJson("skills/korean-prose-editor/contracts/provider-plan.schema.json");
expect(planSchema.properties?.actorIds?.minItems === 3 && planSchema.properties?.actorIds?.maxItems === 3, "actorIds must have exact length 3");
expect(planSchema.properties?.actorIds?.uniqueItems === true, "actorIds must require uniqueItems");
expect(!Object.hasOwn(planSchema.properties?.providers?.properties?.finalization?.properties ?? {}, "actorId"), "finalizer must not define actorId");

const receiptSchema = await readJson("skills/korean-prose-editor/contracts/receipt.schema.json");
expect(
  JSON.stringify(receiptSchema.required) === JSON.stringify(["schemaVersion", "actorIds", "digest", "length", "decisions", "warnings"]),
  "receipt root allowlist mismatch",
);

for (const [index, schemaName] of ["edit-decision-set.v1", "edit-candidate.v1", "edit-verification-report.v1", "final-text-receipt.v1"].entries()) {
  const outputSchema = await readJson(`skills/korean-prose-editor/contracts/${schemaName}.schema.json`);
  const expected = index < 3
    ? ["schemaVersion", "actorId", "digest", "length", "decisions", "warnings"]
    : ["schemaVersion", "actorIds", "digest", "length", "decisions", "warnings"];
  expect(JSON.stringify(outputSchema.required) === JSON.stringify(expected), `${schemaName} receipt fields mismatch`);
  const warningItems = outputSchema.properties?.warnings?.items ?? outputSchema.$defs?.warnings?.items;
  expect(Array.isArray(warningItems?.enum) && warningItems.enum.length > 0 && !Object.hasOwn(warningItems, "pattern"), `${schemaName} warnings must use a finite enum`);
}

const scriptFiles = await listFiles(path.join(skillRoot, "scripts"), ".mjs");
for (const scriptPath of scriptFiles) {
  const contents = await readFile(scriptPath, "utf8");
  expect(!/\b(?:fetch|XMLHttpRequest|axios|openai|anthropic)\s*\(/i.test(contents), `${path.relative(root, scriptPath)} may call a model or network API`);
}

const provenance = await readJson("evals/legacy/provenance.json");
expect(provenance.purpose === "evaluation-only" && provenance.canonicalSkill === false, "legacy provenance boundary mismatch");
for (const artifact of provenance.artifacts ?? []) {
  expect(!/SKILL\.md$/i.test(artifact.sourcePath), "legacy candidate SKILL.md must not be copied");
  const artifactPath = path.join(root, artifact.copyPath);
  const digest = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
  expect(digest === artifact.sha256, `legacy artifact digest mismatch: ${artifact.copyPath}`);
}
const corpusLines = (await readFile(path.join(root, "evals/legacy/translationese-100/corpus.jsonl"), "utf8")).trim().split("\n");
expect(corpusLines.length === 100, "legacy corpus must contain exactly 100 cases");
const corpusIds = corpusLines.map((line) => JSON.parse(line).id);
expect(new Set(corpusIds).size === 100, "legacy corpus case IDs must be unique");
const freeze = await readJson("evals/FREEZE.json");
expect(freeze.bindings?.holdoutCasesSha256 === "710c1c116fec0cbbcf22634a021f48bd979f6cce2518fd83ed93607d88bf1e84", "holdout freeze digest mismatch");
expect(freeze.bindings?.legacyCorpusSha256 === "2a457c0bf1d5478afa4cf2469d38521b0c6d1bfde4e1dad195abff1477b34a1c", "legacy corpus freeze digest mismatch");
expect(freeze.bindings?.protocolSha256 === "ce0886a88d8efd68712210f0c1d3d59d42bfad6d18b626fed2ff36b0af944237", "evaluation protocol freeze digest mismatch");
expect(freeze.runCount === 3, "evaluation must require three role-separated runs");

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`repository validation passed (${required.length} required files, ${scriptFiles.length} runtime scripts)`);
}

/** @param {boolean} condition @param {string} message */
function expect(condition, message) {
  if (!condition) failures.push(message);
}

/** @param {string} relative */
async function readJson(relative) {
  try {
    return JSON.parse(await readFile(path.join(root, relative), "utf8"));
  } catch (error) {
    failures.push(`invalid JSON ${relative}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

/** @param {string} directory @param {string} extension */
async function listFiles(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(child, extension);
    return entry.name.endsWith(extension) ? [child] : [];
  }));
  return nested.flat();
}
