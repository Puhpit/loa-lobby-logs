import type { CharacterCandidate } from "../shared/types.js";

const LOST_ARK_NAME_PATTERN = /^\p{L}[\p{L}\p{N}]{3,15}$/u;
const OCR_UI_DENYLIST = new Set([
  "applicant",
  "button",
  "cancel",
  "create",
  "creategroup",
  "createlobby",
  "details",
  "enter",
  "group",
  "invite",
  "leave",
  "lobby",
  "lobbyhasbeenput",
  "lobbyhasbeenpu",
  "master",
  "member",
  "need",
  "party",
  "rarty",
  "rartyv",
  "reclear",
  "raid",
  "rect",
  "rec",
  "recr",
  "recru",
  "recrt",
  "recrui",
  "recruit",
  "recruiti",
  "recruitmentlobby",
  "recruiting",
  "reset",
  "selected",
  "send",
  "seen",
  "settings",
  "supp",
  "support",
  "title",
  "tree",
  "viewdetails",
  "view"
]);

const LOST_ARK_SERVER_NAMES = [
  "arcturus",
  "balthorr",
  "brelshaza",
  "elpon",
  "gienah",
  "inanna",
  "luterra",
  "luttera",
  "nineveh",
  "ortuus",
  "ratik",
  "thaemine",
  "vairgrys"
];

const LOST_ARK_SERVER_KEYS = new Set(LOST_ARK_SERVER_NAMES.map((name) => fuzzyKey(name)));

export interface OcrTokenAnalysis {
  rawToken: string;
  normalizedName: string;
  textRole: CharacterCandidate["textRole"];
  rejectedReason?: CharacterCandidate["rejectedReason"];
}

export function normalizeOcrName(rawText: string): string {
  const compact = rawText
    .replace(/[|()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeOcrNames(compact).at(-1) ?? "";
}

export function normalizeOcrNames(rawText: string): string[] {
  return analyzeOcrNames(rawText)
    .filter((token) => !token.rejectedReason)
    .map((token) => token.normalizedName);
}

export function analyzeOcrNames(rawText: string): OcrTokenAnalysis[] {
  return tokenParts(rawText)
    .map((rawToken) => classifyOcrToken(rawToken));
}

function tokenParts(rawText: string): string[] {
  return rawText
    .replace(/[|()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
}

function classifyOcrToken(rawToken: string): OcrTokenAnalysis {
  const normalizedName = rawToken;
  const lower = normalizedName.toLocaleLowerCase();
  if (OCR_UI_DENYLIST.has(lower)) {
    return { rawToken, normalizedName, textRole: "ui", rejectedReason: "ui-token" };
  }
  if (isPlaceholderToken(lower)) {
    return { rawToken, normalizedName, textRole: "placeholder", rejectedReason: "placeholder" };
  }
  if (/^lv\d{1,3}$/i.test(normalizedName)) {
    return { rawToken, normalizedName, textRole: "ui", rejectedReason: "ui-token" };
  }
  if (isServerLikeToken(lower)) {
    return { rawToken, normalizedName, textRole: "server", rejectedReason: "server-like" };
  }
  if (!LOST_ARK_NAME_PATTERN.test(normalizedName)) {
    return { rawToken, normalizedName, textRole: "unknown", rejectedReason: "invalid-name-shape" };
  }
  return { rawToken, normalizedName, textRole: "name" };
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

  return dropNearDuplicateNames(dropPartialNames([...bestByName.values()].sort((left, right) => right.confidence - left.confidence)));
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

function dropNearDuplicateNames(candidates: CharacterCandidate[]): CharacterCandidate[] {
  const kept: CharacterCandidate[] = [];
  for (const candidate of candidates) {
    const key = fuzzyKey(candidate.normalizedName);
    const duplicateIndex = kept.findIndex((other) => {
      const otherKey = fuzzyKey(other.normalizedName);
      if (!key || !otherKey) return false;
      const minLength = Math.min(key.length, otherKey.length);
      if (minLength < 5) return false;
      if (key.includes(otherKey) || otherKey.includes(key)) return Math.abs(key.length - otherKey.length) <= 3;
      const maxDistance = minLength >= 8 ? 2 : 1;
      return levenshteinDistance(key, otherKey) <= maxDistance;
    });
    if (duplicateIndex === -1) {
      kept.push(candidate);
      continue;
    }

    const other = kept[duplicateIndex];
    const otherKey = fuzzyKey(other.normalizedName);
    if (isBetterNearDuplicate(key, otherKey, candidate.confidence, other.confidence)) {
      kept[duplicateIndex] = candidate;
    }
  }
  return kept;
}

function isBetterNearDuplicate(candidateKey: string, existingKey: string, candidateConfidence: number, existingConfidence: number): boolean {
  if (looksLikeLeadingNoiseVariant(existingKey, candidateKey)) return true;
  if (looksLikeLeadingNoiseVariant(candidateKey, existingKey)) return false;
  return candidateConfidence > existingConfidence;
}

function looksLikeLeadingNoiseVariant(longerKey: string, shorterKey: string): boolean {
  return longerKey.length - shorterKey.length === 1 && levenshteinDistance(longerKey.slice(1), shorterKey) <= 1;
}

function isPlaceholderToken(value: string): boolean {
  return value === "recruitingraidgroup" || value === "empty" || value === "locked";
}

export function isServerLikeToken(value: string): boolean {
  if (LOST_ARK_SERVER_NAMES.includes(value)) return true;
  const key = fuzzyKey(value);
  if (LOST_ARK_SERVER_KEYS.has(key)) return true;

  return LOST_ARK_SERVER_NAMES.some((server) => {
    const serverKey = fuzzyKey(server);
    const distance = levenshteinDistance(key, serverKey);
    const maxDistance = serverKey.length >= 8 ? 2 : 1;
    return distance <= maxDistance;
  });
}

function fuzzyKey(value: string): string {
  return foldLatin(value)
    .toLocaleLowerCase()
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "l")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/vv/g, "w")
    .replace(/rn/g, "m")
    .replace(/[^a-z]/g, "");
}

function foldLatin(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}
