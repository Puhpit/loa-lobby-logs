import { describe, expect, it } from "vitest";
import { resolveEncounter, summarizeLobbyCharacters } from "../src/main/lobbySummary.js";
import type { CharacterLogsResult, LogEntry, LogProvider, Region } from "../src/shared/types.js";

function log(overrides: Partial<LogEntry>): LogEntry {
  return {
    id: "id",
    name: "Badseedrestart",
    boss: "Armoche, Sentinel of the Abyss",
    difficulty: "Hard",
    dps: 100,
    ndps: 50,
    className: "Sorceress",
    percentile: 0.5,
    duration: 1000,
    timestamp: 1,
    isBus: false,
    isDead: false,
    ...overrides
  };
}

function result(region: Region, name: string, logs: LogEntry[]): CharacterLogsResult {
  return {
    region,
    name,
    logsEnabled: true,
    isPublic: true,
    logs
  };
}

function searchResult(region: Region, name: string, resolvedFromSearch: string, logs: LogEntry[]): CharacterLogsResult {
  return {
    ...result(region, name, logs),
    resolvedFromSearch
  };
}

describe("resolveEncounter", () => {
  it("maps visible Lost Ark encounter labels to lostark.bible boss groups", () => {
    expect(resolveEncounter("[Hard] Fortress of Destruction")).toEqual({
      visibleText: "[Hard] Fortress Of Destruction",
      groupName: "Armoche",
      difficulty: "Hard",
      bosses: ["Brelshaza, Ember in the Ashes", "Armoche, Sentinel of the Abyss"]
    });
  });

  it("maps in-game lobby aliases and bracketed difficulty", () => {
    expect(resolveEncounter("[The First] Final Day")).toEqual({
      visibleText: "[The First] Final Day",
      groupName: "Kazeros",
      difficulty: "The First",
      bosses: ["Death Incarnate Kazeros", "Archdemon Kazeros", "Abyss Lord Kazeros"]
    });
    expect(resolveEncounter("[Hard]Final Day")).toEqual({
      visibleText: "[Hard] Final Day",
      groupName: "Kazeros",
      difficulty: "Hard",
      bosses: ["Death Incarnate Kazeros", "Archdemon Kazeros", "Abyss Lord Kazeros"]
    });
    expect(resolveEncounter("[Nightmare] Sanctum of Frost").groupName).toBe("Serca");
    expect(resolveEncounter("[Normal] Mount Antares")).toEqual({
      visibleText: "[Normal] Mount Antares",
      groupName: "Mordum",
      difficulty: "Normal",
      bosses: ["Mordum, the Abyssal Punisher", "Flash of Punishment", "Blossoming Fear, Naitreya", "Infernas"]
    });
    expect(resolveEncounter("[Hard] Fortress of Destruction").groupName).toBe("Armoche");
  });

  it("recovers noisy OCR encounter text with ordered token matching", () => {
    expect(resolveEncounter("Hard]Final 1 Day Gate 1 1-2 hw lf dps")).toEqual({
      visibleText: "[Hard] Final Day",
      groupName: "Kazeros",
      difficulty: "Hard",
      bosses: ["Death Incarnate Kazeros", "Archdemon Kazeros", "Abyss Lord Kazeros"]
    });
    expect(resolveEncounter("Party 1 [Nightmare] Sanctum random Frost Recruiting Raid Group").groupName).toBe("Serca");
  });

  it("leaves tied encounter alias matches unresolved", () => {
    expect(resolveEncounter("Final Sanctum Day Frost")).toEqual({
      visibleText: "Final Sanctum Day Frost",
      groupName: undefined,
      difficulty: undefined,
      bosses: []
    });
  });

  it("leaves unknown encounter text as an unfiltered lookup", () => {
    expect(resolveEncounter("[Normal]Dark Baratron")).toEqual({
      visibleText: "[Normal]Dark Baratron",
      groupName: undefined,
      difficulty: "Normal",
      bosses: []
    });
  });
});

describe("summarizeLobbyCharacters", () => {
  it("dedupes OCR names and summarizes logs against the visible encounter", async () => {
    const calls: string[] = [];
    const provider: LogProvider = {
      async getCharacterLogs(region, name, options) {
        calls.push(`${region}:${name}:${options?.bosses?.join("|") ?? "unfiltered"}`);
        return result(region, name, [
          log({ id: "encounter", boss: "Armoche, Sentinel of the Abyss", percentile: 0.9, dps: 200, ndps: 80 }),
          log({ id: "recent", boss: "Other Boss", percentile: 0.1, dps: 1000, ndps: 900 })
        ]);
      }
    };

    const summary = await summarizeLobbyCharacters({
      region: "NA",
      visibleEncounterText: "[Hard] Fortress of Destruction",
      characterNames: [" Badseedrestart ", "badseedrestart", "Pepegami"],
      logProvider: provider
    });

    expect(calls).toEqual([
      "NA:Badseedrestart:Brelshaza, Ember in the Ashes|Armoche, Sentinel of the Abyss",
      "NA:Pepegami:Brelshaza, Ember in the Ashes|Armoche, Sentinel of the Abyss"
    ]);
    expect(summary.encounter.groupName).toBe("Armoche");
    expect(summary.characters).toHaveLength(2);
    expect(summary.characters[0].bestPercentile).toBe(0.9);
    expect(summary.characters[0].bestDps).toBe(200);
  });

  it("falls back to recent unfiltered logs when filtered encounter lookup is empty", async () => {
    const calls: string[] = [];
    const provider: LogProvider = {
      async getCharacterLogs(region, name, options) {
        calls.push(options?.bosses?.length ? "filtered" : "unfiltered");
        return result(
          region,
          name,
          options?.bosses?.length ? [] : [log({ id: "recent", boss: "Other Boss", percentile: 0.8 })]
        );
      }
    };

    const summary = await summarizeLobbyCharacters({
      region: "NA",
      visibleEncounterText: "[Hard] Fortress of Destruction",
      characterNames: ["Pepegami"],
      logProvider: provider
    });

    expect(calls).toEqual(["filtered", "unfiltered"]);
    expect(summary.characters[0].flags).toContain("no-encounter-match");
    expect(summary.characters[0].bestPercentile).toBe(0.8);
    expect(summary.characters[0].selectedLog?.id).toBe("recent");
  });

  it("marks individual scrape failures without failing the whole lobby summary", async () => {
    const provider: LogProvider = {
      async getCharacterLogs(region, name) {
        if (name === "Broken") throw new Error("request failed");
        return result(region, name, [log({ id: name, name })]);
      }
    };

    const summary = await summarizeLobbyCharacters({
      region: "NA",
      visibleEncounterText: "[Hard] Fortress of Destruction",
      characterNames: ["Broken", "Pepegami"],
      logProvider: provider
    });

    expect(summary.characters.map((character) => character.name)).toEqual(["Broken", "Pepegami"]);
    expect(summary.characters[0].flags).toEqual(["no-public-logs", "scrape-failed"]);
    expect(summary.characters[0].errorMessage).toBe("request failed");
    expect(summary.characters[1].flags).not.toContain("scrape-failed");
  });

  it("uses canonical names returned by strict search recovery and flags the correction", async () => {
    const provider: LogProvider = {
      async getCharacterLogs(region, name) {
        return searchResult(region, "Spártácus", name, [log({ id: "accented", name: "Spártácus" })]);
      }
    };

    const summary = await summarizeLobbyCharacters({
      region: "NA",
      visibleEncounterText: "[Hard] Fortress of Destruction",
      characterNames: ["Spartacus"],
      logProvider: provider
    });

    expect(summary.characters[0].name).toBe("Spártácus");
    expect(summary.characters[0].flags).toContain("ocr-search-corrected");
  });
});
