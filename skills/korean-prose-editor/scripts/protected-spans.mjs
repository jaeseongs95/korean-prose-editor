import { SCHEMA_VERSION, sha256 } from "./lib.mjs";

/** @typedef {{kind: string, start: number, end: number, text: string, priority: number}} Candidate */

const PATTERNS = [
  { kind: "fenced-code", priority: 100, regex: /```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/gu },
  { kind: "inline-code", priority: 90, regex: /`[^`\n]+`/gu },
  { kind: "url", priority: 70, regex: /https?:\/\/[^\s<>()[\]{}"'，。！？]+/gu },
  { kind: "quotation", priority: 60, regex: /“[^”\n]+”|‘[^’\n]+’|「[^」\n]+」|『[^』\n]+』|《[^》\n]+》|〈[^〉\n]+〉|"[^"\n]+"|'[^'\n]+'/gu },
  { kind: "number-or-date", priority: 50, regex: /(?:\d{4}[./-]\d{1,2}[./-]\d{1,2}(?!\d)|(?<![\p{L}\p{N}_])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?%?)(?![\p{L}\p{N}_]))/gu },
];

/** @param {string} source */
export function extractProtectedSpans(source) {
  if (typeof source !== "string") throw new TypeError("source must be a string");
  /** @type {Candidate[]} */
  const candidates = [];

  for (const pattern of PATTERNS) {
    for (const match of source.matchAll(pattern.regex)) {
      const start = match.index;
      candidates.push({
        kind: pattern.kind,
        start,
        end: start + match[0].length,
        text: match[0],
        priority: pattern.priority,
      });
    }
  }

  for (const match of source.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/gu)) {
    const target = match[1];
    const relativeStart = match[0].lastIndexOf(target);
    const start = match.index + relativeStart;
    candidates.push({ kind: "markdown-target", start, end: start + target.length, text: target, priority: 80 });
  }

  candidates.sort((left, right) => left.start - right.start || right.priority - left.priority || right.end - left.end);
  /** @type {Candidate[]} */
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((span) => candidate.start < span.end && span.start < candidate.end)) continue;
    selected.push(candidate);
  }
  selected.sort((left, right) => left.start - right.start || left.end - right.end);

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceDigest: sha256(source),
    sourceLength: source.length,
    spans: selected.map(({ kind, start, end, text }, index) => ({
      id: `span-${String(index + 1).padStart(4, "0")}`,
      kind,
      start,
      end,
      text,
      digest: sha256(text),
    })),
  };
}

/** @param {number} start @param {number} end @param {{start: number, end: number}[]} spans */
export function overlapsProtectedSpan(start, end, spans) {
  if (start === end) return spans.some((span) => span.start < start && start < span.end);
  return spans.some((span) => start < span.end && span.start < end);
}
