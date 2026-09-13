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
  "skills/korean-prose-editor/LICENSE",
  "skills/korean-prose-editor/THIRD_PARTY_NOTICES.md",
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
  "skills/korean-prose-editor/contracts/source-unit-manifest.v1.schema.json",
  "skills/korean-prose-editor/contracts/selection-work-product.v1.schema.json",
  "skills/korean-prose-editor/contracts/editing-work-product.v1.schema.json",
  "skills/korean-prose-editor/contracts/editing-draft.v1.schema.json",
  "skills/korean-prose-editor/contracts/verification-work-product.v1.schema.json",
  "skills/korean-prose-editor/scripts/source-units.mjs",
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
  "evals/cycles/0.1.0-rc2/cycle-definition.json",
  "evals/cycles/0.1.0-rc2/EVALUATION_PROTOCOL.md",
  "evals/cycles/0.1.0-rc2/thresholds.json",
  "evals/cycles/0.1.0-rc2/diagnostic/inventory.json",
  "evals/cycles/0.1.0-rc2/diagnostic/semantic-drift-regressions.jsonl",
  "evals/cycles/0.1.0-rc2/diagnostic/selection-taxonomy-contrast/spec.json",
  "evals/cycles/0.1.0-rc2/diagnostic/selection-taxonomy-contrast/input.jsonl",
  "evals/cycles/0.1.0-rc2/diagnostic/selection-taxonomy-contrast/key.json",
  "evals/cycles/0.1.0-rc2/diagnostic/selection-taxonomy-contrast/source-unit-manifest.jsonl",
  "evals/cycles/0.1.0-rc2/schemas/fresh-holdout.schema.json",
  "evals/cycles/0.1.0-rc2/schemas/run-meta.schema.json",
  "scripts/prepare-evaluation-cycle.mjs",
  "scripts/prepare-source-unit-manifests.mjs",
  "scripts/record-selection-run.mjs",
  "scripts/record-editing-run.mjs",
  "scripts/prepare-semantic-regression.mjs",
  "scripts/prepare-historical-regression-work-products.mjs",
  "scripts/aggregate-semantic-regression.mjs",
  "scripts/prepare-verification-minimal-contrast.mjs",
  "scripts/prepare-new-semantic-candidates.mjs",
  "scripts/aggregate-selection-diagnostic.mjs",
  "scripts/aggregate-selection-taxonomy-contrast.mjs",
  "scripts/aggregate-new-semantic-candidates.mjs",
  "scripts/aggregate-evaluation-cycle.mjs",
  "scripts/summarize-evaluation-cycle.mjs",
];
const removedLegacyEvaluationEntrypoints = [
  "scripts/prepare-evaluation.mjs",
  "scripts/prepare-verification-input.mjs",
  "scripts/prepare-disagreement-audit.mjs",
  "scripts/aggregate-evaluation.mjs",
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
const rootLicense = await readFile(path.join(root, "LICENSE"), "utf8");
const rootNotices = await readFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
const skillLicense = await readFile(path.join(skillRoot, "LICENSE"), "utf8");
const skillNotices = await readFile(path.join(skillRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
expect(rootLicense.includes("Copyright (c) 2025 Siqi Chen"), "upstream MIT copyright notice missing");
expect(rootLicense.includes("Copyright (c) 2026 korean-prose-editor contributors"), "project copyright notice missing");
expect(normalizeNewlines(skillLicense) === normalizeNewlines(rootLicense), "skill LICENSE must match root LICENSE");
expect(normalizeNewlines(skillNotices) === normalizeNewlines(rootNotices), "skill THIRD_PARTY_NOTICES must match root notices");
for (const requiredNotice of [
  "https://github.com/jaeseongs95/humanizer-ko",
  "3326ce796be98e90ea23c807f36fe0482c14ec09",
  "https://github.com/blader/humanizer",
  "9862685f575c65a8247f90369951df1b3416e3d6",
  "Copyright (c) 2025 Siqi Chen",
  "미출시 로컬 작업본",
]) expect(rootNotices.includes(requiredNotice), `third-party notice missing: ${requiredNotice}`);
for (const command of ["eval:prepare", "eval:prepare-verification", "eval:prepare-audit", "eval:aggregate"]) {
  expect(!Object.hasOwn(packageJson.scripts ?? {}, command), `legacy candidateText evaluation command must stay removed: ${command}`);
}
for (const relative of removedLegacyEvaluationEntrypoints) {
  try {
    await access(path.join(root, relative), constants.R_OK);
    failures.push(`legacy candidateText evaluation entrypoint must stay removed: ${relative}`);
  } catch {
    // Absence is required: the sealed legacy evidence remains, but cannot be rerun through candidateText diff inference.
  }
}

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
const finalizationProvider = descriptor.providers?.[3];
expect(finalizationProvider?.requiredInputArtifacts?.includes("edit-decision-set"), "finalizer must require edit-decision-set");
expect(finalizationProvider?.inputBindings?.some((binding) => binding.targetArtifact === "edit-decision-set" && binding.sources?.includes("provider:korean-prose-selection.edit-decision-set")), "finalizer must bind selection evidence");

for (const schemaName of ["provider-plan", "protected-manifest", "finalization-request", "receipt", "edit-decision-set.v1", "edit-candidate.v1", "edit-verification-report.v1", "final-text-receipt.v1", "source-unit-manifest.v1", "selection-work-product.v1", "editing-draft.v1", "editing-work-product.v1", "verification-work-product.v1"]) {
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
expect(provenance.sourceRepository?.url === "https://github.com/jaeseongs95/humanizer-ko", "humanizer-ko provenance URL mismatch");
expect(provenance.sourceRepository?.publicBaseTag === "v2.0.2" && provenance.sourceRepository?.publicBaseCommit === "3326ce796be98e90ea23c807f36fe0482c14ec09", "humanizer-ko public base mismatch");
expect(provenance.sourceRepository?.snapshotKind === "local-unpublished-working-tree", "legacy snapshot kind mismatch");
expect(provenance.upstreamRepository?.url === "https://github.com/blader/humanizer" && provenance.upstreamRepository?.baseCommit === "9862685f575c65a8247f90369951df1b3416e3d6", "upstream provenance mismatch");
for (const artifact of provenance.artifacts ?? []) {
  expect(!/SKILL\.md$/i.test(artifact.sourcePath), "legacy candidate SKILL.md must not be copied");
  expect(!path.isAbsolute(artifact.sourcePath) && !/^[A-Za-z]:[\\/]/u.test(artifact.sourcePath), "legacy provenance must not expose a local absolute source path");
  expect(["public-base-commit", "local-unpublished-working-tree"].includes(artifact.sourceState), "legacy artifact source state mismatch");
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

const cycleDefinition = await readJson("evals/cycles/0.1.0-rc2/cycle-definition.json");
expect(cycleDefinition.runCount === 3, "rc2 evaluation must require exactly three runs");
expect(JSON.stringify(cycleDefinition.paths?.policies) === JSON.stringify([
  "skills/korean-prose-editor/references/selection-policy.md",
  "skills/korean-prose-editor/references/editing-policy.md",
  "skills/korean-prose-editor/references/verification-rubric.md",
]), "rc2 must freeze canonical role policies");
for (const schema of ["source-unit-manifest.v1", "selection-work-product.v1", "editing-work-product.v1", "verification-work-product.v1"]) {
  expect(cycleDefinition.paths?.privateSchemas?.includes(`skills/korean-prose-editor/contracts/${schema}.schema.json`), `rc2 missing canonical schema ${schema}`);
}

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

/** @param {string} value */
function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}
