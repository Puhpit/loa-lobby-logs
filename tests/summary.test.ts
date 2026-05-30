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
  it("prioritizes current encounter logs", () => {
    const summary = summarizeCharacter("Pepegami", [
      log({ id: "a", boss: "Armoche, Sentinel of the Abyss", dps: 200, ndps: 80, percentile: 0.9 }),
      log({ id: "b", boss: "Other Boss", dps: 1000, ndps: 900, percentile: 0.1 })
    ], ["Armoche, Sentinel of the Abyss"]);

    expect(summary.bestPercentile).toBe(0.9);
    expect(summary.bestDps).toBe(200);
    expect(summary.medianNdps).toBe(80);
    expect(summary.flags).not.toContain("no-encounter-match");
  });
});
