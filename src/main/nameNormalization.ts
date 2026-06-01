import type { CharacterCandidate } from "../shared/types.js";

const LOST_ARK_NAME_PATTERN = /^\p{L}[\p{L}\p{N}]{3,15}$/u;
const OCR_STOP_WORDS = new Set([
  "applicant",
  "aegir",
  "akkan",
  "arcturus",
  "armoche",
  "azena",
  "balthorr",
  "arty",
  "brelshaza",
  "ceos",
  "dbslca",
  "details",
  "echidna",
  "elpon",
  "ezrebet",
  "final",
  "first",
  "gate",
  "group",
  "hard",
  "inanna",
  "iting",
  "kadan",
  "kazeros",
  "kharmine",
  "lobby",
  "luterra",
  "luttera",
  "mari",
  "member",
  "mordum",
  "neria",
  "nightmare",
  "nineveh",
  "noma",
  "normal",
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
  "serca",
  "thaemine",
  "una",
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
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((part) => LOST_ARK_NAME_PATTERN.test(part))
    .filter((part) => !OCR_STOP_WORDS.has(part.toLocaleLowerCase()));
}

export function dedupeCharacterCandidates(candidates: CharacterCandidate[]): CharacterCandidate[] {
  const bestByName = new Map<string, CharacterCandidate>();

  for (const candidate of candidates) {
    const normalizedName = candidate.normalizedName || normalizeOcrName(candidate.rawText);
    if (!normalizedName) continue;

    const normalizedCandidate = { ...candidate, normalizedName };
    const key = normalizedName.toLocaleLowerCase();
    const existing = bestByName.get(key);

    if (!existing || normalizedCandidate.confidence > existing.confidence) {
      bestByName.set(key, normalizedCandidate);
    }
  }

  return dropPartialNames([...bestByName.values()].sort((left, right) => right.confidence - left.confidence));
}

function dropPartialNames(candidates: CharacterCandidate[]): CharacterCandidate[] {
  return candidates.filter((candidate) => {
    const name = candidate.normalizedName.toLocaleLowerCase();
    return !candidates.some((other) => {
      const otherName = other.normalizedName.toLocaleLowerCase();
      return otherName !== name && otherName.startsWith(name) && otherName.length - name.length >= 2;
    });
  });
}
