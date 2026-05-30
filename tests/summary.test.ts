import { describe, expect, it } from "vitest";
import { summarizeCharacter } from "../src/main/summary.js";
import type { LogEntry } from "../src/shared/types.js";

function log(overrides: Partial<LogEntry>): LogEntry {
  return {
    id: "id",
    name: "Pepegami",
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

describe("summarizeCharacter", () => {
  it("prioritizes current encounter logs for aggregate stats", () => {
    const summary = summarizeCharacter(
      "Pepegami",
      [
        log({ id: "a", boss: "Armoche, Sentinel of the Abyss", dps: 200, ndps: 80, percentile: 0.9 }),
        log({ id: "b", boss: "Other Boss", dps: 1000, ndps: 900, percentile: 0.1 })
      ],
      ["Armoche, Sentinel of the Abyss"]
    );

    expect(summary.bestPercentile).toBe(0.9);
    expect(summary.bestDps).toBe(200);
    expect(summary.medianNdps).toBe(80);
    expect(summary.flags).not.toContain("no-encounter-match");
  });

  it("sorts display rows by percentile primary, DPS secondary, and nDPS tertiary", () => {
    const summary = summarizeCharacter(
      "Pepegami",
      [
        log({ id: "lower-percentile", percentile: 0.8, dps: 9_999, ndps: 9_999 }),
        log({ id: "highest-ndps", percentile: 0.9, dps: 5_000, ndps: 4_000 }),
        log({ id: "highest-dps", percentile: 0.9, dps: 6_000, ndps: 1_000 }),
        log({ id: "highest-percentile", percentile: 0.95, dps: 1_000, ndps: 1_000 })
      ],
      ["Armoche, Sentinel of the Abyss"]
    );

    expect(summary.currentEncounterLogs.map((entry) => entry.id)).toEqual([
      "highest-percentile",
      "highest-dps",
      "highest-ndps",
      "lower-percentile"
    ]);
  });
});
