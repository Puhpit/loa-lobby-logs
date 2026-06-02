import { describe, expect, it } from "vitest";
import { displayMetricsForLog, percentileBadge, summarizeCharacter } from "../src/main/summary.js";
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
    expect(summary.selectedLog?.id).toBe("a");
    expect(summary.displayMetrics?.role).toBe("dps");
    expect(summary.displayMetrics?.performance[0].value).toBe("200");
    expect(summary.flags).not.toContain("no-encounter-match");
  });

  it("selects the latest matching encounter log for display", () => {
    const summary = summarizeCharacter(
      "Pepegami",
      [
        log({ id: "best-percentile", percentile: 0.95, timestamp: 10 }),
        log({ id: "latest", percentile: 0.5, timestamp: 30 }),
        log({ id: "middle", percentile: 0.8, timestamp: 20 })
      ],
      ["Armoche, Sentinel of the Abyss"]
    );

    expect(summary.currentEncounterLogs.map((entry) => entry.id)).toEqual(["latest", "middle", "best-percentile"]);
    expect(summary.selectedLog?.id).toBe("latest");
  });

  it("uses selected display log combat power in the summary", () => {
    const summary = summarizeCharacter(
      "Pepegami",
      [
        log({ id: "selected", combatPower: 5216.7099609375, timestamp: 20 }),
        log({ id: "newer-other", boss: "Other Boss", combatPower: 6000, timestamp: 30 })
      ],
      ["Armoche, Sentinel of the Abyss"]
    );

    expect(summary.selectedLog?.id).toBe("selected");
    expect(summary.combatPower).toBe(5216.7099609375);
  });

  it("falls back to latest log combat power when there is no selected log", () => {
    const summary = summarizeCharacter("Pepegami", [log({ id: "latest", combatPower: 6000, timestamp: 30 })], []);

    expect(summary.selectedLog?.id).toBe("latest");
    expect(summary.combatPower).toBe(6000);
  });

  it("uses header metadata when no logs are available", () => {
    const summary = summarizeCharacter("Privatebard", [], ["Armoche, Sentinel of the Abyss"], {
      id: 1,
      serial: "serial",
      rosterId: 2,
      classKey: "bard",
      className: "Bard",
      itemLevel: 1700.5
    });

    expect(summary.className).toBe("Bard");
    expect(summary.gearScore).toBe(1700.5);
    expect(summary.flags).toContain("no-public-logs");
  });

  it("filters current encounter logs by detected difficulty", () => {
    const summary = summarizeCharacter(
      "Pepegami",
      [
        log({ id: "hard-latest", difficulty: "Hard", timestamp: 30 }),
        log({ id: "normal-newer", difficulty: "Normal", timestamp: 50 })
      ],
      { bosses: ["Armoche, Sentinel of the Abyss"], difficulty: "Hard" }
    );

    expect(summary.currentEncounterLogs.map((entry) => entry.id)).toEqual(["hard-latest"]);
    expect(summary.selectedLog?.id).toBe("hard-latest");
  });

  it("selects matching Kazeros logs over newer Serca logs", () => {
    const summary = summarizeCharacter(
      "Fatalvalky",
      [
        log({ id: "newer-serca", boss: "Corvus Tul Rak", difficulty: "Hard", timestamp: 50, percentile: 0.99 }),
        log({ id: "hard-kazeros", boss: "Death Incarnate Kazeros", difficulty: "Hard", timestamp: 30, percentile: 0.98 })
      ],
      { bosses: ["Death Incarnate Kazeros", "Archdemon Kazeros", "Abyss Lord Kazeros"], difficulty: "Hard" }
    );

    expect(summary.currentEncounterLogs.map((entry) => entry.id)).toEqual(["hard-kazeros"]);
    expect(summary.selectedLog?.id).toBe("hard-kazeros");
    expect(summary.flags).not.toContain("no-encounter-match");
  });

  it("uses support display metrics for support specs", () => {
    const metrics = displayMetricsForLog(log({
      spec: "Desperate Salvation",
      buffs: [0.95, 0.96, 0.6, 0.37],
      rContribution: 0.509,
      contributionPercentile: 0.43,
      percentile: 0.28
    }));

    expect(metrics.role).toBe("support");
    expect(metrics.percentileBadges.map((badge) => badge.label)).toEqual(["43", "28"]);
    expect(metrics.performance.map((entry) => entry.value)).toEqual(["95", "96", "60", "37"]);
    expect(metrics.ndps).toEqual({ label: "rDPS", marker: "r", value: "50.9%" });
  });

  it("matches lostark.bible percentile color thresholds", () => {
    expect(percentileBadge(1)?.backgroundColor).toBe("#e5cc80");
    expect(percentileBadge(0.99)?.backgroundColor).toBe("#ee59a5");
    expect(percentileBadge(0.95)?.backgroundColor).toBe("#ff8000");
    expect(percentileBadge(0.75)?.backgroundColor).toBe("#a75ed5");
    expect(percentileBadge(0.5)?.backgroundColor).toBe("#0096ff");
    expect(percentileBadge(0.25)?.backgroundColor).toBe("#3dd351");
    expect(percentileBadge(0.24)?.backgroundColor).toBe("#6a6a6a");
  });
});
