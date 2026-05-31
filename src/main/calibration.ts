import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { OcrSourceMode, Rect } from "../shared/types.js";

export interface CalibrationConfig {
  version: 1;
  encounterTitle: Rect;
  applicantList: Rect;
  memberList: Rect;
  selectedLobbyRow: Rect;
}

export const defaultCalibration: CalibrationConfig = {
  version: 1,
  encounterTitle: { x: 2425, y: 205, width: 430, height: 44 },
  applicantList: { x: 2200, y: 385, width: 560, height: 60 },
  memberList: { x: 2185, y: 370, width: 640, height: 460 },
  selectedLobbyRow: { x: 2190, y: 430, width: 360, height: 60 }
};

export function cropRectForMode(config: CalibrationConfig, mode: OcrSourceMode): Rect {
  if (mode === "applicant-list") return config.applicantList;
  if (mode === "other-party-selected-lobby") return config.memberList;
  return config.selectedLobbyRow;
}

export function validateCalibrationConfig(value: unknown): CalibrationConfig {
  const config = value as Partial<CalibrationConfig>;

  if (config.version !== 1) {
    throw new Error("Calibration config version must be 1");
  }

  return {
    version: 1,
    encounterTitle: validateRect(config.encounterTitle, "encounterTitle"),
    applicantList: validateRect(config.applicantList, "applicantList"),
    memberList: validateRect(config.memberList, "memberList"),
    selectedLobbyRow: validateRect(config.selectedLobbyRow, "selectedLobbyRow")
  };
}

export async function loadCalibrationConfig(path: string): Promise<CalibrationConfig> {
  try {
    return validateCalibrationConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultCalibration;
    throw error;
  }
}

export async function saveCalibrationConfig(path: string, config: CalibrationConfig): Promise<void> {
  const valid = validateCalibrationConfig(config);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
}

function validateRect(value: unknown, field: string): Rect {
  const rect = value as Partial<Rect>;
  const numbers = [rect?.x, rect?.y, rect?.width, rect?.height];

  if (!numbers.every((number) => typeof number === "number" && Number.isFinite(number))) {
    throw new Error(`Calibration rect ${field} must contain finite x, y, width, and height numbers`);
  }

  if ((rect.width ?? 0) <= 0 || (rect.height ?? 0) <= 0) {
    throw new Error(`Calibration rect ${field} must have positive width and height`);
  }

  return {
    x: Math.max(0, Math.round(rect.x ?? 0)),
    y: Math.max(0, Math.round(rect.y ?? 0)),
    width: Math.round(rect.width ?? 0),
    height: Math.round(rect.height ?? 0)
  };
}
