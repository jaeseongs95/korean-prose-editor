import { finalizeRequest } from "../skills/korean-prose-editor/scripts/finalizer-core.mjs";
import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";

/**
 * Evaluation adapter for the structured runtime contract.
 * Candidate text is reconstructed only from editing.edits. The adapter never
 * infers ranges by diffing an independently supplied candidate string.
 */
export function finalizeEvaluationCase({
  sourceText,
  protectedStrings = [],
  actorIds,
  sourceUnitManifest,
  selection,
  editing,
  verification,
  rubricDigest,
}) {
  if (typeof sourceText !== "string") throw new TypeError("sourceText must be a string");
  if (!Array.isArray(actorIds) || actorIds.length !== 3) throw new TypeError("actorIds must contain three role actors");
  if (!sourceUnitManifest || !selection || !editing || !verification || typeof rubricDigest !== "string") throw new TypeError("structured evaluation work products and rubricDigest are required");

  const manifest = extractProtectedSpans(sourceText, protectedStrings);
  const candidateText = applyStructuredEdits(sourceText, editing.edits);
  const result = finalizeRequest({
    schemaVersion: "1.0.0",
    mode: "mcp",
    subagentsAvailable: true,
    source: sourceText,
    manifest,
    sourceUnitManifest,
    selection,
    editing,
    verification,
    rubricDigest,
    plan: {
      schemaVersion: "1.0.0",
      actorIds,
      providers: {
        selection: { kind: "agent", actorId: actorIds[0] },
        editing: { kind: "agent", actorId: actorIds[1] },
        verification: { kind: "agent", actorId: actorIds[2] },
        finalization: { kind: "deterministic", entrypoint: "scripts/finalize.mjs" },
      },
    },
  });
  const hasDeferredUnit = selection.decisions?.some((decision) => decision.action === "defer") === true;
  return {
    candidateText,
    finalText: result.output,
    finalAction: result.output !== sourceText ? "edit" : hasDeferredUnit ? "defer" : "retain",
    restored: candidateText !== sourceText && result.output === sourceText,
    receipt: result.receipt,
  };
}

export const finalizeStructuredEvaluationCase = finalizeEvaluationCase;

function applyStructuredEdits(source, edits) {
  if (!Array.isArray(edits)) throw new TypeError("editing.edits must be an array");
  let output = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start || right.end - left.end || right.id.localeCompare(left.id))) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > source.length || typeof edit.replacement !== "string") {
      throw new TypeError("editing.edits contains an invalid range");
    }
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }
  return output;
}
