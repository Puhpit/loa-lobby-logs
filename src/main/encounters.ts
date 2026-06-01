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

export function bossGroupForVisibleEncounter(visibleText: string): string | undefined {
  const normalized = normalizeVisibleEncounter(visibleText);

  for (const [alias, group] of Object.entries(visibleEncounterAliases)) {
    if (normalized.includes(alias)) return group;
  }

  return undefined;
}

function normalizeVisibleEncounter(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
