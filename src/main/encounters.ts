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
    .filter((match): match is VisibleEncounterMatch & { start: number; end: number; span: number } => Boolean(match))
    .sort((left, right) => left.span - right.span || left.start - right.start);

  if (matches.length === 0) return undefined;
  if (matches.length > 1 && matches[0].span === matches[1].span) return undefined;

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

function orderedTokenSpan(tokens: string[], aliasTokens: string[]): { start: number; end: number; span: number } | undefined {
  let searchFrom = 0;
  let start = -1;
  let end = -1;

  for (const aliasToken of aliasTokens) {
    const index = tokens.indexOf(aliasToken, searchFrom);
    if (index === -1) return undefined;
    if (start === -1) start = index;
    end = index;
    searchFrom = index + 1;
  }

  return { start, end, span: end - start };
}
