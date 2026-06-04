const CLASS_ICON_BASE_URL = "https://raw.githubusercontent.com/snoww/loa-logs/master/static/images/classes";

export const lostArkBibleClassNames: Record<string, string> = {
  na: "",
  warrior: "Warrior",
  berserker: "Berserker",
  destroyer: "Destroyer",
  warlord: "Gunlancer",
  holyknight: "Paladin",
  warrior_female: "Warrior",
  berserker_female: "Slayer",
  holyknight_female: "Valkyrie",
  magician: "Mage",
  arcana: "Arcanist",
  summoner: "Summoner",
  bard: "Bard",
  elemental_master: "Sorceress",
  fighter: "Martial Artist",
  battle_master: "Wardancer",
  infighter: "Scrapper",
  force_master: "Soulfist",
  lance_master: "Glaivier",
  fighter_male: "Martial Artist",
  battle_master_male: "Striker",
  infighter_male: "Breaker",
  delain: "Assassin",
  blade: "Deathblade",
  demonic: "Shadowhunter",
  reaper: "Reaper",
  soul_eater: "Souleater",
  hunter: "Gunner",
  hawkeye: "Sharpshooter",
  hawk_eye: "Sharpshooter",
  devil_hunter: "Deadeye",
  blaster: "Artillerist",
  scouter: "Machinist",
  hunter_female: "Gunner",
  devil_hunter_female: "Gunslinger",
  specialist: "Specialist",
  yinyangshi: "Artist",
  weather_artist: "Aeromancer",
  alchemist: "Wildsoul",
  dragon_human: "Guardianknight",
  dragon_knight: "Guardianknight"
};

export const loaLogsClassNameToClassId: Record<string, number> = {
  Unknown: 0,
  "Warrior (Male)": 101,
  Berserker: 102,
  Destroyer: 103,
  Gunlancer: 104,
  Paladin: 105,
  "Female Warrior": 111,
  Slayer: 112,
  Valkyrie: 113,
  Mage: 201,
  Arcanist: 202,
  Summoner: 203,
  Bard: 204,
  Sorceress: 205,
  "Martial Artist (Female)": 301,
  Wardancer: 302,
  Scrapper: 303,
  Soulfist: 304,
  Glaivier: 305,
  "Martial Artist (Male)": 311,
  Striker: 312,
  Breaker: 313,
  Assassin: 401,
  Deathblade: 402,
  Shadowhunter: 403,
  Reaper: 404,
  Souleater: 405,
  "Gunner (Male)": 501,
  Sharpshooter: 502,
  Deadeye: 503,
  Artillerist: 504,
  Machinist: 505,
  "Gunner (Female)": 511,
  Gunslinger: 512,
  Specialist: 601,
  Artist: 602,
  Aeromancer: 603,
  Wildsoul: 604,
  Guardianknight: 702
};

export interface ClassIconMetadata {
  className: string;
  classId: number;
  classIconUrl: string;
  classMappingWarning?: string;
}

export function classIconUrl(classId: number): string {
  return `${CLASS_ICON_BASE_URL}/${classId}.png`;
}

export function classMetadataForLostArkBibleKey(classKey: string | undefined): ClassIconMetadata {
  const normalizedKey = normalizeClassKey(classKey);
  const className = normalizedKey ? lostArkBibleClassNames[normalizedKey] : undefined;
  if (!className) {
    return unknownClassMetadata(classKey ? `Unknown lostark.bible class key: ${classKey}` : "Missing lostark.bible class key");
  }

  return classMetadataForDisplayName(className, `Missing loa-logs class ID for ${className} from key ${classKey}`);
}

export function classMetadataForDisplayName(className: string | undefined, warning?: string): ClassIconMetadata {
  const normalizedName = normalizeDisplayClassName(className);
  const classId = loaLogsClassNameToClassId[normalizedName];
  if (typeof classId !== "number") {
    return unknownClassMetadata(warning ?? (className ? `Missing loa-logs class ID for ${className}` : "Missing class name"));
  }

  return {
    className: normalizedName,
    classId,
    classIconUrl: classIconUrl(classId)
  };
}

function normalizeClassKey(classKey: string | undefined): string {
  return String(classKey ?? "").trim().toLowerCase();
}

function normalizeDisplayClassName(className: string | undefined): string {
  const value = String(className ?? "").trim();
  if (value === "Shadow Hunter") return "Shadowhunter";
  if (value === "Guardian Knight") return "Guardianknight";
  return value || "Unknown";
}

function unknownClassMetadata(classMappingWarning: string): ClassIconMetadata {
  return {
    className: "Unknown",
    classId: 0,
    classIconUrl: classIconUrl(0),
    classMappingWarning
  };
}
