import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cropRectForMode, defaultCalibration, loadCalibrationStatus, validateCalibrationConfig } from "../src/main/calibration.js";

describe("validateCalibrationConfig", () => {
  it("accepts and rounds a valid calibration config", () => {
    const config = validateCalibrationConfig({
      ...defaultCalibration,
      applicantList: { x: 1.2, y: 2.6, width: 100.4, height: 50.5 }
    });

    expect(config.applicantList).toEqual({ x: 1, y: 3, width: 100, height: 51 });
  });

  it("rejects invalid rectangles", () => {
    expect(() =>
      validateCalibrationConfig({
        ...defaultCalibration,
        memberList: { x: 0, y: 0, width: 0, height: 20 }
      })
    ).toThrow(/positive width and height/);
  });
});

describe("cropRectForMode", () => {
  it("selects the configured rectangle for each OCR mode", () => {
    expect(cropRectForMode(defaultCalibration, "applicant-list")).toBe(defaultCalibration.applicantList);
    expect(cropRectForMode(defaultCalibration, "other-party-selected-lobby")).toBe(defaultCalibration.memberList);
    expect(cropRectForMode(defaultCalibration, "own-recruitment-lobby")).toBe(defaultCalibration.selectedLobbyRow);
  });
});

describe("loadCalibrationStatus", () => {
  it("distinguishes missing calibration from a saved config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "loa-calibration-test-"));
    try {
      await expect(loadCalibrationStatus(join(dir, "missing.json"))).resolves.toEqual({
        configured: false,
        config: defaultCalibration
      });

      const path = join(dir, "calibration.json");
      await writeFile(path, JSON.stringify(defaultCalibration), "utf8");
      await expect(loadCalibrationStatus(path)).resolves.toEqual({
        configured: true,
        config: defaultCalibration
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
