export const lostArkBibleEncounterGroups: Record<string, string[]> = {
  Serca: ["Corvus Tul Rak", "Witch of Agony, Serca"],
  Kazeros: ["Death Incarnate Kazeros", "Archdemon Kazeros", "Abyss Lord Kazeros"],
  Armoche: ["Brelshaza, Ember in the Ashes", "Armoche, Sentinel of the Abyss"],
  Tarkal: ["Flame of Darkness, Tarkal"],
  "Act 2: Brelshaza": ["Phantom Manifester Brelshaza", "Narok the Butcher"],
  Aegir: ["Aegir, the Oppressor", "Akkan, Lord of Death"],
  Behemoth: ["Behemoth, Cruel Storm Slayer", "Behemoth, the Storm Commander"],
  Echidna: ["Covetous Master Echidna", "Red Doom Narkiel"],
  Thaemine: [
    "Thaemine, Conqueror of Stars",
    "Thaemine the Lightqueller",
    "Valinak, Herald of the End",
    "Killineza the Dark Worshipper"
  ],
  "Ivory Tower": [
    "Lazaram, the Trailblazer",
    "Firehorn, Trampler of Earth",
    "Rakathus, the Lurking Arrogance",
    "Kaltaya, the Blooming Chaos"
  ],
  Akkan: [
    "Lord of Kartheon Akkan",
    "Plague Legion Commander Akkan",
    "Lord of Degradation Akkan",
    "Griefbringer Maurug"
  ],
  Kayangel: ["Lauriel", "Prunya", "Tienis"],
  Brelshaza: [
    "Phantom Legion Commander Brelshaza",
    "Brelshaza, Monarch of Nightmares",
    "Primordial Nightmare",
    "Ashtarot",
    "Gehenna Helkasirs"
  ],
  "Kakul-Saydon": ["Kakul-Saydon", "Kakul", "Saydon"],
  Vykas: [
    "Covetous Legion Commander Vykas",
    "Covetous Devourer Vykas",
    "Nightmarish Morphe",
    "Incubus Morphe"
  ],
  Valtan: ["Ravaged Tyrant of Beasts", "Dark Mountain Predator"]
};

export function bossGroupForVisibleEncounter(visibleText: string): string | undefined {
  const normalized = visibleText.toLowerCase();
  return Object.keys(lostArkBibleEncounterGroups).find((group) =>
    normalized.includes(group.toLowerCase())
  );
}
