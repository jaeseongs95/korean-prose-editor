import { finalizeRequest } from "../skills/korean-prose-editor/scripts/finalizer-core.mjs";
import { extractProtectedSpans } from "../skills/korean-prose-editor/scripts/protected-spans.mjs";
import { sha256 } from "../skills/korean-prose-editor/scripts/lib.mjs";

/** Align unchanged protected spans first, then diff only the intervening prose. */
export function candidateEdits(source, candidate, manifest) {
  const spans = manifest.spans;
  const positions = [];
  let cursor = 0;
  for (const span of spans) {
    if (count(source, span.text) !== count(candidate, span.text)) return { edits: [], fallback: true };
    const start = candidate.indexOf(span.text, cursor);
    if (start === -1) return { edits: [], fallback: true };
    positions.push(start);
    cursor = start + span.text.length;
  }
  // A second possible anchor placement is ambiguous; do not guess which occurrence moved.
  cursor = candidate.length;
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    const start = candidate.lastIndexOf(span.text, cursor - span.text.length);
    if (start !== positions[index]) return { edits: [], fallback: true };
    cursor = start;
  }

  const edits = [];
  let sourceCursor = 0;
  let candidateCursor = 0;
  for (let index = 0; index <= spans.length; index += 1) {
    const sourceEnd = spans[index]?.start ?? source.length;
    const candidateEnd = positions[index] ?? candidate.length;
    const changes = diffRegion(source.slice(sourceCursor, sourceEnd), candidate.slice(candidateCursor, candidateEnd), sourceCursor);
    if (changes === null) return { edits: [], fallback: true };
    edits.push(...changes);
    sourceCursor = spans[index]?.end ?? source.length;
    candidateCursor = candidateEnd + (spans[index]?.text.length ?? 0);
  }
  let reconstructed = source;
  for (const edit of [...edits].reverse()) reconstructed = reconstructed.slice(0, edit.start) + edit.replacement + reconstructed.slice(edit.end);
  return reconstructed === candidate ? { edits, fallback: false } : { edits: [], fallback: true };
}

function diffRegion(source, candidate, offset) {
  if (source === candidate) return [];
  const before = Array.from(source);
  const after = Array.from(candidate);
  // Bound memory use. Oversized or unalignable inputs restore the source.
  if ((before.length + 1) * (after.length + 1) > 4_000_000) return null;
  const width = after.length + 1;
  const lengths = new Uint32Array((before.length + 1) * width);
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      lengths[left * width + right] = before[left] === after[right]
        ? 1 + lengths[(left + 1) * width + right + 1]
        : Math.max(lengths[(left + 1) * width + right], lengths[left * width + right + 1]);
    }
  }
  const edits = [];
  let left = 0;
  let right = 0;
  let position = offset;
  let pending;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) {
      if (pending) edits.push(pending);
      pending = undefined;
      position += before[left].length;
      left += 1;
      right += 1;
    } else {
      pending ??= { start: position, end: position, replacement: "" };
      // Ties choose deletion consistently within unprotected prose.
      if (left < before.length && (right === after.length || lengths[(left + 1) * width + right] >= lengths[left * width + right + 1])) {
        position += before[left].length;
        pending.end = position;
        left += 1;
      } else {
        pending.replacement += after[right];
        right += 1;
      }
    }
  }
  if (pending) edits.push(pending);
  return edits;
}

function count(text, value) {
  let total = 0;
  for (let index = text.indexOf(value); index !== -1; index = text.indexOf(value, index + 1)) total += 1;
  return total;
}

export function finalizeEvaluationCase({ sourceText, candidateText, protectedStrings = [], actorIds, verification, selectionAction = "edit", editingActorId = actorIds[1] }) {
  const presentStrings = protectedStrings.filter((value) => typeof value === "string" && value.length > 0 && sourceText.includes(value));
  const manifest = extractProtectedSpans(sourceText, presentStrings);
  const diff = candidateEdits(sourceText, candidateText, manifest);
  const uncertain = [verification.finalDecision, verification.meaningPreservation, verification.registerCompliance, verification.protectedStrings, verification.terminologyJudgment].includes("uncertain");
  const accepted = verification.finalDecision === "accept" && verification.meaningPreservation === "pass" && verification.majorMeaningChange === false && verification.registerCompliance === "pass" && verification.protectedStrings === "pass" && ["pass", "not-applicable"].includes(verification.terminologyJudgment);
  const fallback = presentStrings.length !== protectedStrings.length || diff.fallback || uncertain || (selectionAction !== "edit" && candidateText !== sourceText);
  const edits = diff.edits.map((edit, index) => ({ ...edit, id: `edit-${index + 1}`, sourceDigest: sha256(sourceText), actorId: editingActorId }));
  const request = {
    schemaVersion: "1.0.0", mode: "mcp", subagentsAvailable: true,
    source: sourceText, manifest, edits,
    plan: {
      schemaVersion: "1.0.0", actorIds,
      providers: {
        selection: { kind: "agent", actorId: actorIds[0] },
        editing: { kind: "agent", actorId: actorIds[1] },
        verification: { kind: "agent", actorId: actorIds[2] },
        finalization: { kind: "deterministic", entrypoint: "scripts/finalize.mjs" },
      },
    },
    verification: {
      actorId: verification.actorId,
      globalDecision: fallback ? "fallback" : "continue",
      decisions: edits.map((edit) => ({ editId: edit.id, decision: accepted ? "accept" : "retain", reasonCode: accepted ? "MEANING_PRESERVED" : "VERIFIER_RETAIN" })),
    },
  };
  const result = finalizeRequest(request);
  return {
    finalText: result.output,
    finalAction: result.output !== sourceText ? "edit" : result.receipt.decisions.fallback ? "defer" : "retain",
    restored: candidateText !== sourceText && result.output === sourceText,
    receipt: result.receipt,
  };
}
