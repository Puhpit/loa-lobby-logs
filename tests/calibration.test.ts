import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { emptyCalibration, loadCalibrationConfig, loadCalibrationStatus, validateCalibrationConfig } from "../src/main/calibration.js";

describe("validateCalibrationConfig", () => {
  it("accepts and rounds a valid calibration config", () => {
    const config = validateCalibrationConfig({
      version: 1,
      encounterTitle: { x: 4.4, y: 5.5, width: 80.1, height: 20.2 },
      characterList: { x: 1.2, y: 2.6, width: 100.4, height: 50.5 }
    });

    expect(config.encounterTitle).toEqual({ x: 4, y: 6, width: 80, height: 20 });
    expect(config.characterList).toEqual({ x: 1, y: 3, width: 100, height: 51 });
  });

  it("rejects invalid rectangles", () => {
    expect(() =>
      validateCalibrationConfig({
        version: 1,
        encounterTitle: { x: 1, y: 1, width: 1, height: 1 },
        characterList: { x: 0, y: 0, width: 0, height: 20 }
      })
    ).toThrow(/positive width and height/);
  });

  it("rejects old single-region calibration configs", () => {
    expect(() =>
      validateCalibrationConfig({
        version: 1,
        encounterTitle: { x: 0, y: 0, width: 10, height: 10 },
        applicantList: { x: 0, y: 0, width: 10, height: 10 },
        memberList: { x: 0, y: 0, width: 10, height: 10 },
        selectedLobbyRow: { x: 0, y: 0, width: 10, height: 10 }
      })
    ).toThrow(/Legacy calibration/);
  });
});

describe("loadCalibrationStatus", () => {
  it("distinguishes missing calibration from a saved config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "loa-calibration-test-"));
    try {
      await expect(loadCalibrationStatus(join(dir, "missing.json"))).resolves.toEqual({
        configured: false,
        config: emptyCalibration,
        zones: { encounterTitle: false, characterList: false }
      });

      const path = join(dir, "calibration.json");
      const savedCalibration = {
        version: 1,
        encounterTitle: { x: 1, y: 2, width: 3, height: 4 },
        characterList: { x: 5, y: 6, width: 7, height: 8 }
      };
      await writeFile(path, JSON.stringify(savedCalibration), "utf8");
      await expect(loadCalibrationStatus(path)).resolves.toEqual({
        configured: true,
        config: savedCalibration,
        zones: { encounterTitle: true, characterList: true }
      });

      const partialPath = join(dir, "partial-calibration.json");
      const partialCalibration = {
        version: 1,
        encounterTitle: { x: 1, y: 2, width: 3, height: 4 }
      };
      await writeFile(partialPath, JSON.stringify(partialCalibration), "utf8");
      await expect(loadCalibrationStatus(partialPath)).resolves.toEqual({
        configured: false,
        config: partialCalibration,
        zones: { encounterTitle: true, characterList: false }
      });
      await expect(loadCalibrationConfig(partialPath)).rejects.toThrow(/characterList/);

      const oldPath = join(dir, "old-calibration.json");
      await writeFile(oldPath, JSON.stringify({
        version: 1,
        encounterTitle: { x: 0, y: 0, width: 10, height: 10 },
        applicantList: { x: 0, y: 0, width: 10, height: 10 },
        memberList: { x: 0, y: 0, width: 10, height: 10 },
        selectedLobbyRow: { x: 0, y: 0, width: 10, height: 10 }
      }), "utf8");
      await expect(loadCalibrationStatus(oldPath)).resolves.toEqual({
        configured: false,
        config: emptyCalibration,
        zones: { encounterTitle: false, characterList: false }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
