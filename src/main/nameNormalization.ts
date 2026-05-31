import type { CharacterCandidate } from "../shared/types.js";

const LOST_ARK_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]{3,15}$/;
const OCR_STOP_WORDS = new Set([
  "applicant",
  "arty",
  "brelshaza",
  "ceos",
  "dbslca",
  "details",
  "group",
  "iting",
  "lobby",
  "member",
  "noma",
  "oaciting",
  "party",
  "rai",
  "raid",
  "recrui",
  "recruit",
  "recruiti",
  "recruiting",
  "settings",
  "selected",
  "view"
]);

export function normalizeOcrName(rawText: string): string {
  const compact = rawText
    .replace(/[|()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const candidates = compact
    .split(" ")
    .map((part) => part.replace(/[^A-Za-z0-9]/g, ""))
    .filter((part) => LOST_ARK_NAME_PATTERN.test(part))
    .filter((part) => !OCR_STOP_WORDS.has(part.toLowerCase()));

  return candidates.at(-1) ?? "";
}

export function dedupeCharacterCandidates(candidates: CharacterCandidate[]): CharacterCandidate[] {
  const bestByName = new Map<string, CharacterCandidate>();

  for (const candidate of candidates) {
    const normalizedName = candidate.normalizedName || normalizeOcrName(candidate.rawText);
    if (!normalizedName) continue;

    const normalizedCandidate = { ...candidate, normalizedName };
    const key = normalizedName.toLowerCase();
    const existing = bestByName.get(key);

    if (!existing || normalizedCandidate.confidence > existing.confidence) {
      bestByName.set(key, normalizedCandidate);
    }
  }

  return [...bestByName.values()].sort((left, right) => right.confidence - left.confidence);
}
