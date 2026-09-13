#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJsonl, serializeJsonl, writeNewFile } from "./lib/evaluation-cycle.mjs";
import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";
import { createSourceUnitManifest } from "../skills/korean-prose-editor/scripts/source-units.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const inputFile = resolveRepositoryPath(options.input);
const outputFile = resolveRepositoryPath(options.output);
const input = parseJsonl(await readFile(inputFile, "utf8"));
const manifests = input.map((item) => {
  if (typeof item.sourceText !== "string" || !Array.isArray(item.protectedStrings)) throw new Error(`INVALID_EVALUATION_INPUT:${item.id ?? "unknown"}`);
  return createSourceUnitManifest(item.sourceText, extractProtectedSpans(item.sourceText, item.protectedStrings));
});
await writeNewFile(outputFile, serializeJsonl(manifests));
console.log(JSON.stringify({ caseCount: manifests.length, output: path.relative(root, outputFile).split(path.sep).join("/") }));

function resolveRepositoryPath(value) {
  if (!value) throw new Error("--input and --output are required");
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`PATH_OUTSIDE_REPOSITORY:${value}`);
  return resolved;
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
