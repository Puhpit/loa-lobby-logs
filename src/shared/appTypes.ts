import type { CalibrationConfig, CalibrationStatus, CalibrationTarget, SavedCalibrationConfig } from "../main/calibration.js";
import type { CharacterCandidate, CharacterSummary, Rect, Region } from "./types.js";

export type CaptureMode = "foreground-window-display";
export type OverlayPosition = "left" | "right";

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
    difficulty?: string;
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

export type ScanProgressStage =
  | "needs-calibration"
  | "capturing"
  | "ocr-encounter"
  | "ocr-characters"
  | "fetching-logs"
  | "rendering"
  | "done"
  | "error";

export interface ScanProgress {
  stage: ScanProgressStage;
  message: string;
  scanId?: string;
}

export interface AppApi {
  reviewLobby(input: ReviewLobbyInput): Promise<ReviewLobbyOutput>;
  startScan(): Promise<ScanResult | undefined>;
  onScanResultUpdated(callback: (result: ScanResult) => void): () => void;
  onScanProgressUpdated(callback: (progress: ScanProgress) => void): () => void;
  dismissOverlay(): Promise<void>;
  openSettings(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  openLogs(): Promise<string>;
  reportRendererEvent(event: string, data?: Record<string, unknown>): Promise<void>;
  reportRendererError(event: string, data: Record<string, unknown>): Promise<void>;
  runScreenshotOcr(screenshotPath: string): Promise<CharacterCandidate[]>;
  chooseScreenshot(): Promise<string | undefined>;
  getCalibration(): Promise<SavedCalibrationConfig>;
  getCalibrationStatus(): Promise<CalibrationStatus>;
  saveCalibration(config: SavedCalibrationConfig): Promise<SavedCalibrationConfig>;
  startCalibration(target: CalibrationTarget): Promise<SavedCalibrationConfig | undefined>;
  completeCalibration(target: CalibrationTarget, rect?: Rect): Promise<void>;
  setAlwaysOnTop(value: boolean): Promise<boolean>;
}
