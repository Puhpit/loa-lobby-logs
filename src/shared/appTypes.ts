import type { CalibrationConfig } from "../main/calibration.js";
import type { CharacterCandidate, CharacterSummary, Region } from "./types.js";

export interface ReviewLobbyInput {
  region: Region;
  visibleEncounterText: string;
  manualNames: string[];
  screenshotPath?: string;
  useScreenshotOcr: boolean;
  pages: number;
}

export interface ReviewLobbyOutput {
  encounter: {
    visibleText: string;
    groupName?: string;
    bosses: string[];
  };
  candidates: CharacterCandidate[];
  summaries: CharacterSummary[];
  generatedAt: string;
}

export interface AppApi {
  reviewLobby(input: ReviewLobbyInput): Promise<ReviewLobbyOutput>;
  runScreenshotOcr(screenshotPath: string): Promise<CharacterCandidate[]>;
  chooseScreenshot(): Promise<string | undefined>;
  getCalibration(): Promise<CalibrationConfig>;
  saveCalibration(config: CalibrationConfig): Promise<CalibrationConfig>;
  setAlwaysOnTop(value: boolean): Promise<boolean>;
}
