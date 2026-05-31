import { contextBridge, ipcRenderer } from "electron";
import type { AppApi, AppSettings, ReviewLobbyInput, ScanResult } from "../shared/appTypes.js";
import type { CalibrationConfig } from "./calibration.js";

const api: AppApi = {
  reviewLobby: (input: ReviewLobbyInput) => ipcRenderer.invoke("review-lobby", input),
  startScan: () => ipcRenderer.invoke("start-scan"),
  getLastResult: () => ipcRenderer.invoke("get-last-result"),
  onScanResultUpdated: (callback: (result: ScanResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: ScanResult) => callback(result);
    ipcRenderer.on("scan-result-updated", listener);
    return () => ipcRenderer.removeListener("scan-result-updated", listener);
  },
  showLastResults: () => ipcRenderer.invoke("show-last-results"),
  dismissOverlay: () => ipcRenderer.invoke("dismiss-overlay"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("save-settings", settings),
  openLogs: () => ipcRenderer.invoke("open-logs"),
  reportRendererError: (event: string, data: Record<string, unknown>) => ipcRenderer.invoke("renderer-error", event, data),
  runScreenshotOcr: (screenshotPath: string) => ipcRenderer.invoke("run-screenshot-ocr", screenshotPath),
  chooseScreenshot: () => ipcRenderer.invoke("choose-screenshot"),
  getCalibration: () => ipcRenderer.invoke("get-calibration"),
  saveCalibration: (config: CalibrationConfig) => ipcRenderer.invoke("save-calibration", config),
  setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke("set-always-on-top", value)
};

contextBridge.exposeInMainWorld("loaLobbyLogs", api);
