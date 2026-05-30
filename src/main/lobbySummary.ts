import { bossGroupForVisibleEncounter, lostArkBibleEncounterGroups } from "./encounters.js";
import { summarizeCharacter } from "./summary.js";
import type {
  CharacterLogsResult,
  CharacterSummary,
  LogProvider,
  Region,
  SummaryFlag
} from "../shared/types.js";

export interface EncounterResolution {
  visibleText: string;
  groupName?: string;
  bosses: string[];
}

export interface LobbySummaryResult {
  encounter: EncounterResolution;
  characters: CharacterSummary[];
}

export interface LobbySummaryOptions {
  region: Region;
  visibleEncounterText: string;
  characterNames: string[];
  logProvider: LogProvider;
  pages?: number;
}

export async function summarizeLobbyCharacters(options: LobbySummaryOptions): Promise<LobbySummaryResult> {
  const encounter = resolveEncounter(options.visibleEncounterText);
  const characterNames = uniqueNames(options.characterNames);

  const characters = await Promise.all(
    characterNames.map(async (name) => {
      try {
        const result = await fetchEncounterAwareLogs(options.logProvider, options.region, name, encounter, options.pages);
        return summarizeCharacter(name, result.logs, encounter.bosses);
      } catch {
        return withFlags(summarizeCharacter(name, [], encounter.bosses), ["scrape-failed"]);
      }
    })
  );

  return { encounter, characters };
}

async function fetchEncounterAwareLogs(
  logProvider: LogProvider,
  region: Region,
  name: string,
  encounter: EncounterResolution,
  pages?: number
): Promise<CharacterLogsResult> {
  if (encounter.bosses.length === 0) {
    return logProvider.getCharacterLogs(region, name, { pages });
  }

  const filtered = await logProvider.getCharacterLogs(region, name, { pages, bosses: encounter.bosses });
  if (filtered.logs.length > 0) return filtered;

  return logProvider.getCharacterLogs(region, name, { pages });
}

export function resolveEncounter(visibleText: string): EncounterResolution {
  const groupName = bossGroupForVisibleEncounter(visibleText);

  return {
    visibleText,
    groupName,
    bosses: groupName ? lostArkBibleEncounterGroups[groupName] : []
  };
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    const normalized = name.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function withFlags(summary: CharacterSummary, flags: SummaryFlag[]): CharacterSummary {
  return {
    ...summary,
    flags: [...new Set([...summary.flags, ...flags])]
  };
}
