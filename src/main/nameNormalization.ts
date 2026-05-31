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
  "inanna",
  "iting",
  "lobby",
  "luterra",
  "member",
  "nineveh",
  "noma",
  "oaciting",
  "party",
  "rai",
  "raid",
  "rec",
  "recr",
  "recrui",
  "recruit",
  "recruiti",
  "recruiting",
  "settings",
  "selected",
  "thaemine",
  "vairgrys",
  "view"
]);

export function normalizeOcrName(rawText: string): string {
  const compact = rawText
    .replace(/[|()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeOcrNames(compact).at(-1) ?? "";
}

export function normalizeOcrNames(rawText: string): string[] {
  return rawText
    .replace(/[|()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => part.replace(/[^A-Za-z0-9]/g, ""))
    .filter((part) => LOST_ARK_NAME_PATTERN.test(part))
    .filter((part) => !OCR_STOP_WORDS.has(part.toLowerCase()));
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

  return dropPartialNames([...bestByName.values()].sort((left, right) => right.confidence - left.confidence));
}

function dropPartialNames(candidates: CharacterCandidate[]): CharacterCandidate[] {
  return candidates.filter((candidate) => {
    const name = candidate.normalizedName.toLowerCase();
    return !candidates.some((other) => {
      const otherName = other.normalizedName.toLowerCase();
      return otherName !== name && otherName.startsWith(name) && otherName.length - name.length >= 2;
    });
  });
}
