import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeHotkey } from "./hotkey.js";
import type { AppSettings } from "../shared/appTypes.js";
import type { Region } from "../shared/types.js";

export const defaultSettings: AppSettings = {
  server: "NA",
  scanHotkey: "Ctrl+Alt+D",
  captureMode: "foreground-window-display",
  overlayPosition: "right"
};

export async function loadSettings(path: string): Promise<AppSettings> {
  try {
    return validateSettings(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultSettings;
    throw error;
  }
}

export async function saveSettings(path: string, settings: AppSettings): Promise<AppSettings> {
  const valid = validateSettings(settings);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  return valid;
}

export function validateSettings(value: unknown): AppSettings {
  const settings = value as Partial<AppSettings>;

  return {
    server: validateRegion(settings.server),
    scanHotkey: normalizeHotkey(settings.scanHotkey).userFacing,
    captureMode: "foreground-window-display",
    overlayPosition: "right"
  };
}

function validateRegion(value: unknown): Region {
  return value === "CE" ? "CE" : "NA";
}
