import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Rect } from "../shared/types.js";

export interface CalibrationConfig {
  version: 1;
  encounterTitle: Rect;
  characterList: Rect;
}

export interface SavedCalibrationConfig {
  version: 1;
  encounterTitle?: Rect;
  characterList?: Rect;
}

export interface CalibrationStatus {
  configured: boolean;
  config: SavedCalibrationConfig;
  zones: Record<CalibrationTarget, boolean>;
}

export type CalibrationRectKey = Exclude<keyof CalibrationConfig, "version">;
export type CalibrationTarget = CalibrationRectKey;

export const calibrationTargets: CalibrationTarget[] = [
  "encounterTitle",
  "characterList"
];

export const emptyCalibration: SavedCalibrationConfig = { version: 1 };

export function validateCalibrationConfig(value: unknown): CalibrationConfig {
  const config = validateSavedCalibrationConfig(value);

  return {
    version: 1,
    encounterTitle: validateRect(config.encounterTitle, "encounterTitle"),
    characterList: validateRect(config.characterList, "characterList")
  };
}

export function validateSavedCalibrationConfig(value: unknown): SavedCalibrationConfig {
  const config = value as Partial<SavedCalibrationConfig> & Record<string, unknown>;

  if (config.version !== 1) {
    throw new Error("Calibration config version must be 1");
  }

  if ("applicantList" in config || "memberList" in config || "selectedLobbyRow" in config) {
    throw new Error("Legacy calibration config must be recalibrated");
  }

  return {
    version: 1,
    ...(config.encounterTitle ? { encounterTitle: validateRect(config.encounterTitle, "encounterTitle") } : {}),
    ...(config.characterList ? { characterList: validateRect(config.characterList, "characterList") } : {})
  };
}

export async function loadCalibrationConfig(path: string): Promise<CalibrationConfig> {
  return validateCalibrationConfig(JSON.parse(await readFile(path, "utf8")));
}

export async function loadSavedCalibrationConfig(path: string): Promise<SavedCalibrationConfig> {
  try {
    return validateSavedCalibrationConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof Error) return emptyCalibration;
    throw error;
  }
}

export async function loadCalibrationStatus(path: string): Promise<CalibrationStatus> {
  const config = await loadSavedCalibrationConfig(path);
  const zones = {
    encounterTitle: Boolean(config.encounterTitle),
    characterList: Boolean(config.characterList)
  };
  return {
    configured: zones.encounterTitle && zones.characterList,
    config,
    zones
  };
}

export async function saveCalibrationConfig(path: string, config: SavedCalibrationConfig): Promise<void> {
  const valid = validateSavedCalibrationConfig(config);
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
