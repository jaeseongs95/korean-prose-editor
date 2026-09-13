import { sha256, stableJson } from "../../skills/korean-prose-editor/scripts/lib.mjs";
import { extractProtectedSpans } from "../../skills/korean-prose-editor/scripts/protected-spans.mjs";
import { createSourceUnitManifest } from "../../skills/korean-prose-editor/scripts/source-units.mjs";

export const actorIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

export function structuredCase(sourceText, editSpecs = [], options = {}) {
  const manifest = extractProtectedSpans(sourceText, options.protectedStrings ?? []);
  const sourceUnitManifest = createSourceUnitManifest(sourceText, manifest);
  const actions = options.actions ?? {};
  const selection = {
    schemaVersion: "1.0.0",
    actorId: actorIds[0],
    sourceDigest: sha256(sourceText),
    status: options.selectionStatus ?? "ready",
    decisions: sourceUnitManifest.units.map((unit) => ({
      unitId: unit.unitId,
      action: actions[unit.unitId] ?? (unit.kind === "prose" ? "edit" : "retain"),
      reasonCodes: [],
      riskFlags: [],
      additionalProtectedStrings: options.additionalProtectedStrings?.[unit.unitId] ?? [],
    })),
  };
  const edits = editSpecs.map((spec, index) => {
    const start = spec.start ?? sourceText.indexOf(spec.original);
    if (start < 0) throw new Error(`edit source not found: ${spec.original}`);
    const end = spec.end ?? start + (spec.original?.length ?? 0);
    const unit = sourceUnitManifest.units.find((item) => item.start <= start && end <= item.end);
    return {
      id: spec.id ?? `edit-${index + 1}`,
      unitId: spec.unitId ?? unit?.unitId ?? "unit-missing",
      sourceDigest: sha256(sourceText),
      start,
      end,
      replacement: spec.replacement,
      actorId: actorIds[1],
    };
  });
  const candidateText = applyEdits(sourceText, edits);
  const editing = {
    schemaVersion: "1.0.0",
    actorId: actorIds[1],
    sourceDigest: sha256(sourceText),
    selectionDigest: sha256(stableJson(selection)),
    edits,
    candidateDigest: sha256(candidateText),
  };
  const retained = new Set(options.retainedEditIds ?? []);
  const omitted = new Set(options.omittedDecisionIds ?? []);
  const rubricDigest = sha256("fixed verification rubric");
  const verification = {
    schemaVersion: "1.0.0",
    actorId: actorIds[2],
    sourceDigest: sha256(sourceText),
    editingDigest: sha256(stableJson(editing)),
    rubricDigest,
    globalDecision: options.globalDecision ?? "continue",
    decisions: edits.filter((edit) => !omitted.has(edit.id)).map((edit) => ({
      editId: edit.id,
      decision: retained.has(edit.id) ? "retain" : "accept",
      reasonCode: retained.has(edit.id) ? "MEANING_RISK" : "MEANING_PRESERVED",
    })),
    assessment: {
      meaningPreservation: "pass",
      majorMeaningChange: false,
      registerCompliance: "pass",
      protectedStrings: "pass",
      terminologyJudgment: "not-applicable",
      pairPreference: edits.length === 0 ? "tie" : "candidate",
      ...options.assessment,
    },
  };
  return { sourceText, protectedStrings: options.protectedStrings ?? [], actorIds, sourceUnitManifest, selection, editing, verification, rubricDigest, candidateText };
}

function applyEdits(source, edits) {
  let output = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start || right.end - left.end)) {
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }
  return output;
}
