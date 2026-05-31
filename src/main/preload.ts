import { contextBridge, ipcRenderer } from "electron";
import type { AppApi, ReviewLobbyInput } from "../shared/appTypes.js";
import type { CalibrationConfig } from "./calibration.js";

const api: AppApi = {
  reviewLobby: (input: ReviewLobbyInput) => ipcRenderer.invoke("review-lobby", input),
  runScreenshotOcr: (screenshotPath: string) => ipcRenderer.invoke("run-screenshot-ocr", screenshotPath),
  chooseScreenshot: () => ipcRenderer.invoke("choose-screenshot"),
  getCalibration: () => ipcRenderer.invoke("get-calibration"),
  saveCalibration: (config: CalibrationConfig) => ipcRenderer.invoke("save-calibration", config),
  setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke("set-always-on-top", value)
};

contextBridge.exposeInMainWorld("loaLobbyLogs", api);
