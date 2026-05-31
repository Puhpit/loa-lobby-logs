import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
  type Display,
  type OpenDialogOptions
} from "electron";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defaultCalibration, loadCalibrationConfig, saveCalibrationConfig } from "./calibration.js";
import { createDiagnosticsLogger, errorMessage, type DiagnosticsLogger } from "./diagnostics.js";
import { normalizeHotkey } from "./hotkey.js";
import { getEncounterTextFromScreenshot, ScreenshotCharacterSource } from "./ocrCharacterSource.js";
import { reviewLobby } from "./appPipeline.js";
import { defaultSettings, loadSettings, saveSettings } from "./settings.js";
import type { CalibrationConfig } from "./calibration.js";
import type { AppSettings, ReviewLobbyInput, ScanResult } from "../shared/appTypes.js";
import type { CharacterCandidate, OcrSourceMode, Rect } from "../shared/types.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const calibrationPath = (): string => join(app.getPath("userData"), "calibration.json");
const settingsPath = (): string => join(app.getPath("userData"), "settings.json");

let settingsWindow: BrowserWindow | undefined;
let overlayWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let currentSettings: AppSettings = defaultSettings;
let lastScanResult: ScanResult | undefined;
let scanInFlight: Promise<ScanResult> | undefined;
let isQuitting = false;
let logger: DiagnosticsLogger | undefined;
let logDirectory = "";

app.whenReady().then(async () => {
  logDirectory = join(app.getPath("userData"), "logs");
  logger = createDiagnosticsLogger(logDirectory);
  logger.info("app.ready", {
    userDataPath: app.getPath("userData"),
    logsPath: logDirectory,
    appVersion: app.getVersion()
  });
  registerIpc();
  currentSettings = await loadSettings(settingsPath());
  logger.info("settings.loaded", { settings: currentSettings });
  createTray();
  registerScanHotkey(currentSettings.scanHotkey);

  app.on("activate", async () => {
    await showSettingsWindow();
  });
});

app.on("before-quit", () => {
  logger?.info("app.beforeQuit");
  isQuitting = true;
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Keep the tray app alive until Quit is selected.
});

function registerIpc(): void {
  ipcMain.handle("choose-screenshot", async () => {
    const dialogOptions: OpenDialogOptions = {
      title: "Choose Lost Ark screenshot",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
    };
    const result = settingsWindow
      ? await dialog.showOpenDialog(settingsWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle("get-settings", async () => currentSettings);

  ipcMain.handle("save-settings", async (_event, settings: AppSettings) => {
    currentSettings = await saveSettings(settingsPath(), settings);
    logger?.info("settings.saved", { settings: currentSettings });
    registerScanHotkey(currentSettings.scanHotkey);
    createTray();
    return currentSettings;
  });

  ipcMain.handle("start-scan", async () => runScan());
  ipcMain.handle("get-last-result", async () => lastScanResult);
  ipcMain.handle("show-last-results", async () => {
    if (!lastScanResult) return false;
    await showOverlayWindow(lastScanResult);
    return true;
  });
  ipcMain.handle("dismiss-overlay", async () => {
    logger?.info("overlay.dismiss", {
      hasWindow: Boolean(overlayWindow),
      visible: Boolean(overlayWindow?.isVisible())
    });
    overlayWindow?.hide();
    return Boolean(overlayWindow && !overlayWindow.isVisible());
  });

  ipcMain.handle("open-logs", async () => {
    const logPath = logger?.logPath ?? join(logDirectory, "diagnostics.jsonl");
    await mkdir(logDirectory, { recursive: true });
    await writeFile(logPath, "", { flag: "a" });
    logger?.info("logs.open", { logDirectory, logPath });
    const result = await shell.openPath(logPath);
    if (result) {
      shell.showItemInFolder(logPath);
      logger?.warn("logs.open.fallback", { logDirectory, logPath, result });
      return logPath;
    }
    return logPath;
  });

  ipcMain.handle("renderer-event", async (_event, event: string, data: Record<string, unknown>) => {
    logger?.info(`renderer.${event}`, data);
  });

  ipcMain.handle("renderer-error", async (_event, event: string, data: Record<string, unknown>) => {
    logger?.error(`renderer.${event}`, data, data);
  });

  ipcMain.handle("get-calibration", async () => loadCalibrationConfig(calibrationPath()));

  ipcMain.handle("save-calibration", async (_event, config: CalibrationConfig) => {
    await saveCalibrationConfig(calibrationPath(), config);
    return config;
  });

  ipcMain.handle("run-screenshot-ocr", async (_event, screenshotPath: string) => {
    const calibration = await loadCalibrationConfig(calibrationPath());
    return scanRightSideCandidates(screenshotPath, calibration, "manual-ocr");
  });

  ipcMain.handle("review-lobby", async (_event, input: ReviewLobbyInput) => {
    const calibration = await loadCalibrationConfig(calibrationPath()).catch(() => defaultCalibration);
    const scanId = `manual-${Date.now()}`;
    return reviewLobby(input, {
      userDataPath: app.getPath("userData"),
      calibration,
      logger,
      scanId
    });
  });

  ipcMain.handle("set-always-on-top", (_event, value: boolean) => {
    settingsWindow?.setAlwaysOnTop(value);
    return Boolean(settingsWindow?.isAlwaysOnTop());
  });
}

function createTray(): void {
  if (!tray) {
    tray = new Tray(createTrayIcon());
    tray.setToolTip("LOA Lobby Logs");
  }

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Scan Now (${currentSettings.scanHotkey})`, click: () => {
      logger?.info("tray.scan.clicked");
      void runScan();
    } },
    { label: "Settings", click: () => void showSettingsWindow() },
    { label: "Show Last Results", enabled: Boolean(lastScanResult), click: () => void showOverlayWindow(lastScanResult) },
    { label: "Open Logs", click: () => void shell.openPath(logDirectory) },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        globalShortcut.unregisterAll();
        app.quit();
      }
    }
  ]));
}

function createTrayIcon(): Electron.NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#101417"/><path d="M8 21h16v3H8zM10 8h12l-2 11h-8z" fill="#5fd0e7"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

async function showSettingsWindow(): Promise<void> {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 560,
    minHeight: 420,
    title: "LOA Lobby Logs Settings",
    show: false,
    backgroundColor: "#101417",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    logger?.error("settings.preload.error", error, { preloadPath });
  });

  settingsWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      settingsWindow?.hide();
    }
  });
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
  });

  await settingsWindow.loadFile(join(__dirname, "../renderer/index.html"), { query: { view: "settings" } });
  settingsWindow.show();
}

async function showOverlayWindow(result: ScanResult | undefined): Promise<void> {
  if (!result) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const width = 620;
  const height = Math.min(760, primaryDisplay.workArea.height);
  const x = primaryDisplay.workArea.x + primaryDisplay.workArea.width - width;
  const y = primaryDisplay.workArea.y;

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    logger?.info("overlay.create", { width, height, x, y });
    overlayWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      minWidth: 420,
      minHeight: 320,
      title: "LOA Lobby Logs",
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: "#101417",
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    overlayWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
      logger?.error("overlay.preload.error", error, { preloadPath });
    });
    overlayWindow.on("closed", () => {
      overlayWindow = undefined;
    });
    overlayWindow.webContents.once("did-finish-load", () => {
      logger?.info("overlay.didFinishLoad");
    });
    await overlayWindow.loadFile(join(__dirname, "../renderer/index.html"), { query: { view: "overlay" } });
    logger?.info("overlay.loadFile.done");
  }

  overlayWindow.setBounds({ width, height, x, y });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.show();
  logger?.info("overlay.show", {
    candidateCount: result.candidates.length,
    summaryCount: result.summaries.length,
    generatedAt: result.generatedAt
  });
  logger?.info("overlay.result.send", {
    candidateCount: result.candidates.length,
    summaryCount: result.summaries.length,
    generatedAt: result.generatedAt
  });
  overlayWindow.webContents.send("scan-result-updated", result);
}

function registerScanHotkey(hotkey: string): void {
  globalShortcut.unregisterAll();
  const normalized = normalizeHotkey(hotkey);
  const ok = globalShortcut.register(normalized.accelerator, () => {
    logger?.info("hotkey.triggered", { hotkey: normalized.userFacing, accelerator: normalized.accelerator });
    void runScan();
  });
  logger?.info("hotkey.register", {
    hotkey: normalized.userFacing,
    accelerator: normalized.accelerator,
    ok
  });
  if (!ok) {
    tray?.displayBalloon?.({
      title: "LOA Lobby Logs",
      content: `Could not register hotkey ${normalized.userFacing}. Use the tray Scan Now action.`
    });
  }
}

async function runScan(): Promise<ScanResult> {
  if (scanInFlight) return scanInFlight;

  scanInFlight = runScanInternal()
    .then(async (result) => {
      lastScanResult = result;
      createTray();
      await showOverlayWindow(result);
      return result;
    })
    .finally(() => {
      scanInFlight = undefined;
    });

  return scanInFlight;
}

async function runScanInternal(): Promise<ScanResult> {
  const scanId = `scan-${Date.now()}`;
  const warnings: string[] = [];
  logger?.info("scan.start", { scanId });
  const calibration = await loadCalibrationConfig(calibrationPath()).catch(() => defaultCalibration);
  logger?.info("scan.calibration", { scanId, calibration });
  const capture = await captureForegroundLostArkDisplay(warnings);
  const visibleEncounterText = await getEncounterTextFromScreenshot(capture.screenshotPath, calibration).catch((error) => {
    warnings.push(`Encounter OCR failed: ${error instanceof Error ? error.message : String(error)}`);
    logger?.error("ocr.encounter.error", error, { scanId, screenshotPath: capture.screenshotPath });
    return "";
  });
  logger?.info("ocr.encounter", {
    scanId,
    screenshotPath: capture.screenshotPath,
    cropRect: calibration.encounterTitle,
    rawText: visibleEncounterText
  });
  const candidates = await scanRightSideCandidates(capture.screenshotPath, calibration, scanId).catch((error) => {
    warnings.push(`Character OCR failed: ${error instanceof Error ? error.message : String(error)}`);
    logger?.error("ocr.characters.error", error, { scanId, screenshotPath: capture.screenshotPath });
    return [];
  });

  const output = await reviewLobby({
    region: currentSettings.server,
    visibleEncounterText,
    manualNames: [],
    screenshotPath: capture.screenshotPath,
    useScreenshotOcr: false,
    ocrCandidates: candidates,
    pages: 3
  }, {
    userDataPath: app.getPath("userData"),
    calibration,
    logger,
    scanId
  });

  const result = {
    ...output,
    warnings: [...warnings, ...capture.warnings],
    screenshotPath: capture.screenshotPath
  };
  logger?.info("scan.done", {
    scanId,
    warnings: result.warnings,
    screenshotPath: result.screenshotPath,
    candidateCount: result.candidates.length,
    summaryCount: result.summaries.length
  });
  return result;
}

async function captureForegroundLostArkDisplay(warnings: string[]): Promise<{ screenshotPath: string; warnings: string[] }> {
  const foreground = await getForegroundWindowInfo().catch(() => undefined);
  const displays = screen.getAllDisplays();
  let display = screen.getPrimaryDisplay();
  logger?.info("capture.foreground", { foreground });

  if (foreground?.rect && isLostArkWindow(foreground.title, foreground.processName)) {
    display = displayContainingRect(displays, foreground.rect) ?? display;
  } else {
    warnings.push("Lost Ark was not detected as the foreground window; captured the primary display.");
  }

  const source = await sourceForDisplay(display);
  const screenshotPath = join(tmpdir(), "loa-lobby-logs", `capture-${Date.now()}.png`);
  await mkdir(dirname(screenshotPath), { recursive: true });
  await writeFile(screenshotPath, source.thumbnail.toPNG());
  logger?.info("capture.done", {
    selectedDisplay: {
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor
    },
    source: {
      id: source.id,
      name: source.name,
      displayId: source.display_id,
      thumbnailSize: source.thumbnail.getSize()
    },
    screenshotPath
  });

  return { screenshotPath, warnings };
}

async function sourceForDisplay(display: Display): Promise<Electron.DesktopCapturerSource> {
  const width = Math.round(display.bounds.width * display.scaleFactor);
  const height = Math.round(display.bounds.height * display.scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height }
  });
  const byDisplayId = sources.find((source) => source.display_id === String(display.id));
  return byDisplayId ?? sources[0];
}

async function scanRightSideCandidates(imagePath: string, calibration: CalibrationConfig, scanId: string): Promise<CharacterCandidate[]> {
  const modes: OcrSourceMode[] = ["applicant-list", "other-party-selected-lobby", "own-recruitment-lobby"];
  const groups = await Promise.all(
    modes.map((sourceMode) =>
      new ScreenshotCharacterSource({ imagePath, calibration, sourceMode, logger, scanId }).getVisibleApplicants()
    )
  );

  const candidates = dedupeCandidatesInScreenOrder(groups.flat());
  logger?.info("ocr.characters.done", {
    scanId,
    imagePath,
    candidates: candidates.map((candidate) => candidate.normalizedName)
  });
  return candidates;
}

function dedupeCandidatesInScreenOrder(candidates: CharacterCandidate[]): CharacterCandidate[] {
  const seen = new Set<string>();
  const result: CharacterCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidate.normalizedName.toLowerCase();
    if (!candidate.normalizedName || seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }

  return result;
}

interface ForegroundWindowInfo {
  title: string;
  processName: string;
  rect: Rect;
}

async function getForegroundWindowInfo(): Promise<ForegroundWindowInfo> {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
"@
$hwnd = [Win32]::GetForegroundWindow()
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][Win32]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
$pidValue = 0
[void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$pidValue)
$rect = New-Object RECT
[void][Win32]::GetWindowRect($hwnd, [ref]$rect)
$processName = ""
try { $processName = (Get-Process -Id $pidValue).ProcessName } catch {}
[pscustomobject]@{
  title = $titleBuilder.ToString()
  processName = $processName
  rect = @{ x = $rect.Left; y = $rect.Top; width = ($rect.Right - $rect.Left); height = ($rect.Bottom - $rect.Top) }
} | ConvertTo-Json -Compress
`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
  return JSON.parse(stdout.trim()) as ForegroundWindowInfo;
}

function isLostArkWindow(title: string, processName: string): boolean {
  const value = `${title} ${processName}`.toLowerCase();
  return value.includes("lost ark") || value.includes("lostark");
}

function displayContainingRect(displays: Display[], rect: Rect): Display | undefined {
  const center = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };

  return displays.find((display) =>
    center.x >= display.bounds.x &&
    center.x <= display.bounds.x + display.bounds.width &&
    center.y >= display.bounds.y &&
    center.y <= display.bounds.y + display.bounds.height
  );
}
