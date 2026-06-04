export const lostArkBibleEncounterGroups: Record<string, string[]> = {
  Serca: ["Corvus Tul Rak", "Witch of Agony, Serca"],
  Kazeros: ["Death Incarnate Kazeros", "Archdemon Kazeros", "Abyss Lord Kazeros"],
  Mordum: ["Mordum, the Abyssal Punisher", "Flash of Punishment", "Blossoming Fear, Naitreya", "Infernas"],
  Armoche: ["Brelshaza, Ember in the Ashes", "Armoche, Sentinel of the Abyss"]
};

const visibleEncounterAliases: Record<string, string> = {
  "mount antares": "Mordum",
  "fortress of destruction": "Armoche",
  "final day": "Kazeros",
  "sanctum of frost": "Serca"
};

export interface VisibleEncounterMatch {
  groupName: string;
  alias: string;
}

interface EncounterMatchCandidate {
  groupName: string;
  alias: string;
  start: number;
  end: number;
  span: number;
  distance: number;
}

export function bossGroupForVisibleEncounter(visibleText: string): string | undefined {
  return matchVisibleEncounter(visibleText)?.groupName;
}

export function matchVisibleEncounter(visibleText: string): VisibleEncounterMatch | undefined {
  const tokens = tokenizeVisibleEncounter(visibleText);
  const matches = Object.entries(visibleEncounterAliases)
    .map(([alias, groupName]) => {
      const span = orderedTokenSpan(tokens, tokenizeVisibleEncounter(alias));
      return span ? { alias, groupName, ...span } : undefined;
    })
    .filter((match): match is EncounterMatchCandidate => Boolean(match))
    .sort((left, right) => left.distance - right.distance || left.span - right.span || left.start - right.start);

  if (matches.length === 0) return undefined;
  if (matches.length > 1 && matches[0].distance === matches[1].distance && matches[0].span === matches[1].span) return undefined;

  return { groupName: matches[0].groupName, alias: matches[0].alias };
}

export function tokenizeVisibleEncounter(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token && token !== "of" && !/^\d+$/.test(token));
}

function orderedTokenSpan(tokens: string[], aliasTokens: string[]): { start: number; end: number; span: number; distance: number } | undefined {
  let searchFrom = 0;
  let start = -1;
  let end = -1;
  let totalDistance = 0;

  for (const aliasToken of aliasTokens) {
    const match = nextFuzzyTokenMatch(tokens, aliasToken, searchFrom);
    if (!match) return undefined;
    const { index, distance } = match;
    if (start === -1) start = index;
    end = index;
    totalDistance += distance;
    searchFrom = index + 1;
  }

  return { start, end, span: end - start, distance: totalDistance };
}

function nextFuzzyTokenMatch(tokens: string[], aliasToken: string, searchFrom: number): { index: number; distance: number } | undefined {
  const aliasKey = fuzzyEncounterKey(aliasToken);
  const maxDistance = maxTokenDistance(aliasKey);
  let best: { index: number; distance: number } | undefined;

  for (let index = searchFrom; index < tokens.length; index += 1) {
    const tokenKey = fuzzyEncounterKey(tokens[index]);
    const distance = levenshteinDistance(tokenKey, aliasKey);
    if (distance > maxDistance) continue;
    if (!best || distance < best.distance) best = { index, distance };
    if (distance === 0) break;
  }

  return best;
}

function maxTokenDistance(aliasKey: string): number {
  if (aliasKey.length >= 9) return 2;
  if (aliasKey.length >= 6) return 1;
  return 0;
}

function fuzzyEncounterKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "l")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/vv/g, "w")
    .replace(/rn/g, "m")
    .replace(/[^a-z0-9]/g, "");
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}
