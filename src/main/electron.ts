import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defaultCalibration, loadCalibrationConfig, saveCalibrationConfig } from "./calibration.js";
import { ScreenshotCharacterSource } from "./ocrCharacterSource.js";
import { reviewLobby } from "./appPipeline.js";
import type { CalibrationConfig } from "./calibration.js";
import type { ReviewLobbyInput } from "../shared/appTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const calibrationPath = (): string => join(app.getPath("userData"), "calibration.json");

let mainWindow: BrowserWindow | undefined;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 560,
    minHeight: 420,
    title: "LOA Lobby Logs",
    alwaysOnTop: true,
    backgroundColor: "#101417",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpc(): void {
  ipcMain.handle("choose-screenshot", async () => {
    const dialogOptions: OpenDialogOptions = {
      title: "Choose Lost Ark screenshot",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle("get-calibration", async () => loadCalibrationConfig(calibrationPath()));

  ipcMain.handle("save-calibration", async (_event, config: CalibrationConfig) => {
    await saveCalibrationConfig(calibrationPath(), config);
    return config;
  });

  ipcMain.handle("run-screenshot-ocr", async (_event, screenshotPath: string) => {
    const calibration = await loadCalibrationConfig(calibrationPath());
    return new ScreenshotCharacterSource({ imagePath: screenshotPath, calibration }).getVisibleApplicants();
  });

  ipcMain.handle("review-lobby", async (_event, input: ReviewLobbyInput) => {
    const calibration = await loadCalibrationConfig(calibrationPath()).catch(() => defaultCalibration);
    return reviewLobby(input, {
      userDataPath: app.getPath("userData"),
      calibration
    });
  });

  ipcMain.handle("set-always-on-top", (_event, value: boolean) => {
    mainWindow?.setAlwaysOnTop(value);
    return Boolean(mainWindow?.isAlwaysOnTop());
  });
}
