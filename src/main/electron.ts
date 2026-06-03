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
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  calibrationTargets,
  emptyCalibration,
  loadCalibrationConfig,
  loadCalibrationStatus,
  loadSavedCalibrationConfig,
  saveCalibrationConfig
} from "./calibration.js";
import { createDiagnosticsLogger, errorMessage, type DiagnosticsLogger } from "./diagnostics.js";
import { normalizeHotkey } from "./hotkey.js";
import { getEncounterTextFromScreenshot, ScreenshotCharacterSource } from "./ocrCharacterSource.js";
import { reviewLobby } from "./appPipeline.js";
import { overlayBounds, overlayProgressHeight, overlayResultHeight } from "./overlayWindow.js";
import { defaultSettings, loadSettings, saveSettings } from "./settings.js";
import type { CalibrationConfig, CalibrationTarget, SavedCalibrationConfig } from "./calibration.js";
import type { AppSettings, ReviewLobbyInput, ScanProgress, ScanProgressStage, ScanResult } from "../shared/appTypes.js";
import type { CharacterCandidate, Rect } from "../shared/types.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const calibrationPath = (): string => join(app.getPath("userData"), "calibration.json");
const settingsPath = (): string => join(app.getPath("userData"), "settings.json");

let settingsWindow: BrowserWindow | undefined;
let overlayWindow: BrowserWindow | undefined;
let calibrationWindow: BrowserWindow | undefined;
let pendingCalibration: {
  target: CalibrationTarget;
  display: Display;
  resolve: (config: SavedCalibrationConfig | undefined) => void;
} | undefined;
let tray: Tray | undefined;
let currentSettings: AppSettings = defaultSettings;
let scanInFlight: Promise<ScanResult | undefined> | undefined;
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
  ipcMain.handle("dismiss-overlay", async () => {
    logger?.info("overlay.dismiss", {
      hasWindow: Boolean(overlayWindow),
      visible: Boolean(overlayWindow?.isVisible())
    });
    overlayWindow?.hide();
    return Boolean(overlayWindow && !overlayWindow.isVisible());
  });
  ipcMain.handle("open-settings", async () => {
    await showSettingsWindow();
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

  ipcMain.handle("get-calibration", async () => loadSavedCalibrationConfig(calibrationPath()));
  ipcMain.handle("get-calibration-status", async () => loadCalibrationStatus(calibrationPath()));

  ipcMain.handle("save-calibration", async (_event, config: SavedCalibrationConfig) => {
    await saveCalibrationConfig(calibrationPath(), config);
    return config;
  });

  ipcMain.handle("start-calibration", async (_event, target: CalibrationTarget) => startCalibration(target));

  ipcMain.handle("complete-calibration", async (_event, target: CalibrationTarget, rect?: Rect) => {
    await completeCalibration(target, rect);
  });

  ipcMain.handle("run-screenshot-ocr", async (_event, screenshotPath: string) => {
    const calibration = await loadCalibrationConfig(calibrationPath());
    return scanRightSideCandidates(screenshotPath, calibration, "manual-ocr");
  });

  ipcMain.handle("review-lobby", async (_event, input: ReviewLobbyInput) => {
    const calibration = await loadCalibrationConfig(calibrationPath()).catch(() => undefined);
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
    { label: "Open App Logs", click: () => void shell.openPath(logDirectory) },
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
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "icon.ico")
    : join(process.cwd(), "assets", "icon.ico");

  const image = nativeImage.createFromPath(iconPath);

  if (image.isEmpty()) {
    logger?.warn("tray.icon.empty", { iconPath, exists: existsSync(iconPath) });
  }

  return image;
}

async function showSettingsWindow(): Promise<void> {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 760,
    height: 460,
    minWidth: 560,
    minHeight: 400,
    title: "LOA Lobby Logs Settings",
    icon: createTrayIcon(),
    show: false,
    backgroundColor: "#0a0a0a",
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
      if (!isQuitting) registerScanHotkey(currentSettings.scanHotkey);
    }
  });
  settingsWindow.on("focus", () => {
    logger?.info("settings.focus.hotkeySuspend");
    globalShortcut.unregisterAll();
  });
  settingsWindow.on("blur", () => {
    logger?.info("settings.blur.hotkeyResume");
    if (!isQuitting) registerScanHotkey(currentSettings.scanHotkey);
  });
  settingsWindow.on("hide", () => {
    logger?.info("settings.hide.hotkeyResume");
    if (!isQuitting) registerScanHotkey(currentSettings.scanHotkey);
  });
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
    if (!isQuitting) registerScanHotkey(currentSettings.scanHotkey);
  });

  await settingsWindow.loadFile(join(__dirname, "../renderer/index.html"), { query: { view: "settings" } });
  settingsWindow.show();
}

async function ensureOverlayWindow(height?: number): Promise<BrowserWindow> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const bounds = overlayBounds(primaryDisplay.workArea, currentSettings.overlayPosition, height);
  const { width, height: boundsHeight, x, y } = bounds;

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    logger?.info("overlay.create", { width, height: boundsHeight, x, y });
    overlayWindow = new BrowserWindow({
      width,
      height: boundsHeight,
      x,
      y,
      minWidth: 640,
      minHeight: 96,
      title: "LOA Lobby Logs",
      icon: createTrayIcon(),
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

  overlayWindow.setBounds({ width, height: boundsHeight, x, y });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.show();
  return overlayWindow;
}

async function showOverlayWindow(result: ScanResult): Promise<void> {
  const window = await ensureOverlayWindow(overlayResultHeight(result.summaries.length, result.warnings.length));
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
  window.webContents.send("scan-result-updated", result);
}

async function showOverlayProgress(progress: ScanProgress): Promise<void> {
  const window = await ensureOverlayWindow(overlayProgressHeight(progress.stage));
  logger?.info("scan.progress", { ...progress });
  window.webContents.send("scan-progress-updated", progress);
}

async function emitScanProgress(stage: ScanProgressStage, message: string, scanId?: string): Promise<void> {
  await showOverlayProgress({ stage, message, scanId });
}

async function startCalibration(target: CalibrationTarget): Promise<SavedCalibrationConfig | undefined> {
  if (!calibrationTargets.includes(target)) {
    throw new Error(`Unknown calibration target ${String(target)}`);
  }

  if (pendingCalibration) {
    calibrationWindow?.close();
    pendingCalibration.resolve(undefined);
    pendingCalibration = undefined;
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  logger?.info("calibration.start", { target, display: displayDetails(display) });

  return new Promise((resolve) => {
    pendingCalibration = { target, display, resolve };
    calibrationWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    calibrationWindow.setAlwaysOnTop(true, "screen-saver");
    calibrationWindow.on("closed", () => {
      calibrationWindow = undefined;
      if (pendingCalibration?.target === target) {
        pendingCalibration.resolve(undefined);
        pendingCalibration = undefined;
      }
    });

    void calibrationWindow.loadFile(join(__dirname, "../renderer/index.html"), {
      query: { view: "calibration", target }
    }).then(() => {
      calibrationWindow?.show();
      calibrationWindow?.focus();
    });
  });
}

async function completeCalibration(target: CalibrationTarget, rect?: Rect): Promise<void> {
  const pending = pendingCalibration;
  if (!pending || pending.target !== target) return;

  pendingCalibration = undefined;
  calibrationWindow?.close();
  calibrationWindow = undefined;

  if (!rect || rect.width < 4 || rect.height < 4) {
    logger?.info("calibration.cancel", { target });
    pending.resolve(undefined);
    return;
  }

  const config = await loadSavedCalibrationConfig(calibrationPath()).catch(() => emptyCalibration);
  const scaledRect = rectForDisplayScale(rect, pending.display);
  const nextConfig = { ...config, [target]: scaledRect };
  await saveCalibrationConfig(calibrationPath(), nextConfig);
  logger?.info("calibration.saved", {
    target,
    display: displayDetails(pending.display),
    clientRect: rect,
    scaledRect
  });
  pending.resolve(nextConfig);
}

function rectForDisplayScale(rect: Rect, display: Display): Rect {
  const scale = display.scaleFactor;
  return {
    x: Math.max(0, Math.round(rect.x * scale)),
    y: Math.max(0, Math.round(rect.y * scale)),
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale))
  };
}

function displayDetails(display: Display): Record<string, unknown> {
  return {
    id: display.id,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor
  };
}

function registerScanHotkey(hotkey: string): void {
  globalShortcut.unregisterAll();
  const normalized = normalizeHotkey(hotkey);
  if (settingsWindow?.isFocused()) {
    logger?.info("hotkey.suspended", {
      hotkey: normalized.userFacing,
      accelerator: normalized.accelerator,
      reason: "settings-focused"
    });
    return;
  }
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

async function runScan(): Promise<ScanResult | undefined> {
  if (scanInFlight) return scanInFlight;

  scanInFlight = runScanInternal()
    .then(async (result) => {
      if (!result) return undefined;
      createTray();
      await showOverlayWindow(result);
      return result;
    })
    .catch(async (error) => {
      await emitScanProgress("error", errorMessage(error));
      throw error;
    })
    .finally(() => {
      scanInFlight = undefined;
    });

  return scanInFlight;
}

async function runScanInternal(): Promise<ScanResult | undefined> {
  const scanId = `scan-${Date.now()}`;
  const warnings: string[] = [];
  logger?.info("scan.start", { scanId });
  await emitScanProgress("capturing", "Preparing scan...", scanId);
  const calibrationStatus = await loadCalibrationStatus(calibrationPath()).catch((error) => {
    logger?.error("scan.calibration.status.error", error, { scanId });
    return { configured: false, config: emptyCalibration, zones: { encounterTitle: false, characterList: false } };
  });

  if (!calibrationStatus.configured) {
    await emitScanProgress("needs-calibration", "Calibration is not set. Open settings and calibrate the encounter title and character list before scanning.", scanId);
    logger?.warn("scan.blocked.needsCalibration", { scanId });
    return undefined;
  }

  const calibration = await loadCalibrationConfig(calibrationPath());
  logger?.info("scan.calibration", { scanId, calibration });
  await emitScanProgress("capturing", "Taking screenshot...", scanId);
  const capture = await captureForegroundLostArkDisplay();
  await emitScanProgress("ocr-encounter", "Reading encounter...", scanId);
  const visibleEncounterText = await getEncounterTextFromScreenshot(
    capture.screenshotPath,
    calibration,
    undefined,
    logger,
    scanId
  ).catch((error) => {
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
  await emitScanProgress("ocr-characters", "Reading character names...", scanId);
  const candidates = await scanRightSideCandidates(capture.screenshotPath, calibration, scanId).catch((error) => {
    warnings.push(`Character OCR failed: ${error instanceof Error ? error.message : String(error)}`);
    logger?.error("ocr.characters.error", error, { scanId, screenshotPath: capture.screenshotPath });
    return [];
  });

  await emitScanProgress("fetching-logs", "Pulling public logs...", scanId);
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
  await emitScanProgress("rendering", "Rendering results...", scanId);
  logger?.info("scan.done", {
    scanId,
    warnings: result.warnings,
    screenshotPath: result.screenshotPath,
    candidateCount: result.candidates.length,
    summaryCount: result.summaries.length
  });
  await emitScanProgress("done", "Scan complete", scanId);
  return result;
}

async function captureForegroundLostArkDisplay(): Promise<{ screenshotPath: string; warnings: string[] }> {
  const foreground = await getForegroundWindowInfo().catch(() => undefined);
  const displays = screen.getAllDisplays();
  let display = screen.getPrimaryDisplay();
  logger?.info("capture.foreground", { foreground });

  if (foreground?.rect && isLostArkWindow(foreground.title, foreground.processName)) {
    display = displayContainingRect(displays, foreground.rect) ?? display;
  } else {
    logger?.info("capture.foreground.fallbackPrimaryDisplay", { foreground });
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

  return { screenshotPath, warnings: [] };
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
  const candidates = dedupeCandidatesInScreenOrder(
    await new ScreenshotCharacterSource({
      imagePath,
      calibration,
      sourceMode: "character-list",
      logger,
      scanId,
      debugOutputDir: join(process.cwd(), "local", "debug-ocr")
    }).getVisibleApplicants()
  );
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
  const normalizedProcessName = processName.trim().toLowerCase();
  const value = `${title} ${processName}`.toLowerCase();
  return normalizedProcessName === "lostark" || value.includes("lost ark") || value.includes("lostark");
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
