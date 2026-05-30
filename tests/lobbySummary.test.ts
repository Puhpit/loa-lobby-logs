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

describe("resolveEncounter", () => {
  it("maps visible Lost Ark encounter labels to lostark.bible boss groups", () => {
    expect(resolveEncounter("[Hard] Armoche Gate 2")).toEqual({
      visibleText: "[Hard] Armoche Gate 2",
      groupName: "Armoche",
      bosses: ["Brelshaza, Ember in the Ashes", "Armoche, Sentinel of the Abyss"]
    });
  });

  it("leaves unknown encounter text as an unfiltered lookup", () => {
    expect(resolveEncounter("[Normal]Dark Baratron")).toEqual({
      visibleText: "[Normal]Dark Baratron",
      groupName: undefined,
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
      visibleEncounterText: "[Hard] Armoche",
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
      visibleEncounterText: "[Hard] Armoche",
      characterNames: ["Pepegami"],
      logProvider: provider
    });

    expect(calls).toEqual(["filtered", "unfiltered"]);
    expect(summary.characters[0].flags).toContain("no-encounter-match");
    expect(summary.characters[0].bestPercentile).toBe(0.8);
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
      visibleEncounterText: "[Hard] Armoche",
      characterNames: ["Broken", "Pepegami"],
      logProvider: provider
    });

    expect(summary.characters.map((character) => character.name)).toEqual(["Broken", "Pepegami"]);
    expect(summary.characters[0].flags).toEqual(["no-public-logs", "scrape-failed"]);
    expect(summary.characters[1].flags).not.toContain("scrape-failed");
  });
});
