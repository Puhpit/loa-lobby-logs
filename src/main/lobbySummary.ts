import { lostArkBibleEncounterGroups, matchVisibleEncounter, tokenizeVisibleEncounter } from "./encounters.js";
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
  difficulty?: string;
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
        const flags: SummaryFlag[] = [
          ...(result.resolvedFromSearch ? (["ocr-search-corrected"] as const) : []),
          ...(!result.logsEnabled ? (["no-public-logs"] as const) : [])
        ];
        return withFlags(summarizeCharacter(result.name, result.logs, encounter, result.header), flags);
      } catch (error) {
        return withFlags(summarizeCharacter(name, [], encounter), flagsForError(error), error);
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
  const match = matchVisibleEncounter(visibleText);
  const groupName = match?.groupName;
  const difficulty = parseDifficulty(visibleText);

  return {
    visibleText: match ? formatResolvedVisibleText(match.alias, difficulty) : visibleText,
    groupName,
    difficulty,
    bosses: groupName ? lostArkBibleEncounterGroups[groupName] : []
  };
}

function parseDifficulty(visibleText: string): string | undefined {
  const tokens = tokenizeVisibleEncounter(visibleText);

  for (const token of tokens) {
    if (token === "normal") return "Normal";
    if (token === "hard") return "Hard";
    if (token === "nightmare") return "Nightmare";
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] === "the" && tokens[index + 1] === "first") return "The First";
  }

  return undefined;
}

function formatResolvedVisibleText(alias: string, difficulty: string | undefined): string {
  const title = titleCase(alias);
  return difficulty ? `[${difficulty}] ${title}` : title;
}

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
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

function withFlags(summary: CharacterSummary, flags: SummaryFlag[], error?: unknown): CharacterSummary {
  return {
    ...summary,
    flags: [...new Set([...summary.flags, ...flags])],
    errorMessage: error instanceof Error ? error.message : error ? String(error) : undefined
  };
}

function flagsForError(error: unknown): SummaryFlag[] {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "not_found") return ["character-not-found"];
  if (code === "private_logs") return ["no-public-logs"];
  return ["scrape-failed"];
}
