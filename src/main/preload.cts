import { contextBridge, ipcRenderer } from "electron";
import type { AppApi, AppSettings, ReviewLobbyInput, ScanProgress, ScanResult } from "../shared/appTypes.js";
import type { SavedCalibrationConfig } from "./calibration.js";

const api: AppApi = {
  reviewLobby: (input: ReviewLobbyInput) => ipcRenderer.invoke("review-lobby", input),
  startScan: () => ipcRenderer.invoke("start-scan"),
  onScanResultUpdated: (callback: (result: ScanResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: ScanResult) => callback(result);
    ipcRenderer.on("scan-result-updated", listener);
    return () => ipcRenderer.removeListener("scan-result-updated", listener);
  },
  onScanProgressUpdated: (callback: (progress: ScanProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => callback(progress);
    ipcRenderer.on("scan-progress-updated", listener);
    return () => ipcRenderer.removeListener("scan-progress-updated", listener);
  },
  dismissOverlay: () => ipcRenderer.invoke("dismiss-overlay"),
  openSettings: () => ipcRenderer.invoke("open-settings"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("save-settings", settings),
  openLogs: () => ipcRenderer.invoke("open-logs"),
  reportRendererEvent: (event: string, data?: Record<string, unknown>) => ipcRenderer.invoke("renderer-event", event, data ?? {}),
  reportRendererError: (event: string, data: Record<string, unknown>) => ipcRenderer.invoke("renderer-error", event, data),
  runScreenshotOcr: (screenshotPath: string) => ipcRenderer.invoke("run-screenshot-ocr", screenshotPath),
  chooseScreenshot: () => ipcRenderer.invoke("choose-screenshot"),
  getCalibration: () => ipcRenderer.invoke("get-calibration"),
  getCalibrationStatus: () => ipcRenderer.invoke("get-calibration-status"),
  saveCalibration: (config: SavedCalibrationConfig) => ipcRenderer.invoke("save-calibration", config),
  startCalibration: (target) => ipcRenderer.invoke("start-calibration", target),
  completeCalibration: (target, rect) => ipcRenderer.invoke("complete-calibration", target, rect),
  setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke("set-always-on-top", value)
};

contextBridge.exposeInMainWorld("loaLobbyLogs", api);
