import type { CalibrationConfig } from "../main/calibration.js";
import type { CharacterCandidate, CharacterSummary, Region } from "./types.js";

export type CaptureMode = "foreground-window-display";
export type OverlayPosition = "right";

export interface AppSettings {
  server: Region;
  scanHotkey: string;
  captureMode: CaptureMode;
  overlayPosition: OverlayPosition;
}

export interface ReviewLobbyInput {
  region: Region;
  visibleEncounterText: string;
  manualNames: string[];
  screenshotPath?: string;
  useScreenshotOcr: boolean;
  ocrCandidates?: CharacterCandidate[];
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

export interface ScanResult extends ReviewLobbyOutput {
  warnings: string[];
  screenshotPath?: string;
}

export interface AppApi {
  reviewLobby(input: ReviewLobbyInput): Promise<ReviewLobbyOutput>;
  startScan(): Promise<ScanResult>;
  getLastResult(): Promise<ScanResult | undefined>;
  onScanResultUpdated(callback: (result: ScanResult) => void): () => void;
  showLastResults(): Promise<boolean>;
  dismissOverlay(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  openLogs(): Promise<string>;
  reportRendererError(event: string, data: Record<string, unknown>): Promise<void>;
  runScreenshotOcr(screenshotPath: string): Promise<CharacterCandidate[]>;
  chooseScreenshot(): Promise<string | undefined>;
  getCalibration(): Promise<CalibrationConfig>;
  saveCalibration(config: CalibrationConfig): Promise<CalibrationConfig>;
  setAlwaysOnTop(value: boolean): Promise<boolean>;
}
