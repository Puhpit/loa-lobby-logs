import type { Region } from "../shared/types.js";
import type { AppApi, OverlayPosition, ScanResult } from "../shared/appTypes.js";
import type { CharacterDisplayMetrics, LogEntry, SelectedLogMetric } from "../shared/types.js";
import type { CalibrationTarget } from "../main/calibration.js";

const SUPPORT_SPECS = new Set(["Desperate Salvation", "Full Bloom", "Blessed Aura", "Liberator"]);
const SUPPORT_PERFORMANCE_COLORS = ["#fca5a5", "#86efac", "#fde047", "#93c5fd"];

interface RendererEnvironment {
  window: Window;
  document: Document;
}

export function bootRenderer(env: RendererEnvironment = { window, document }): void {
  installErrorHandlers(env);
  const api = getApi(env.window);

  if (!api) {
    renderFatalPreloadError(env.document);
    return;
  }

  void reportRendererEvent(api, "boot.start", { href: env.window.location.href });
  void reportRendererEvent(api, "boot.api-ready");

  const view = new URLSearchParams(env.window.location.search).get("view") ?? "settings";
  if (view === "overlay") {
    initOverlay(env, api);
  } else if (view === "calibration") {
    initCalibration(env, api);
  } else {
    initSettings(env, api);
  }
}

function installErrorHandlers(env: RendererEnvironment): void {
  env.window.addEventListener("error", (event) => {
    const api = getApi(env.window);
    if (!api) return;
    void api.reportRendererError("error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error instanceof Error ? event.error.stack ?? event.error.message : String(event.error)
    });
  });

  env.window.addEventListener("unhandledrejection", (event) => {
    const api = getApi(env.window);
    if (!api) return;
    void api.reportRendererError("unhandledrejection", {
      reason: event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason)
    });
  });
}

function getApi(windowObj: Window): AppApi | undefined {
  return windowObj.loaLobbyLogs;
}

function renderFatalPreloadError(documentObj: Document): void {
  const message = documentObj.createElement("main");
  message.className = "fatal-error";
  message.innerHTML = `
    <h1>LOA Lobby Logs</h1>
    <p>Renderer preload API is unavailable. Restart the app and check diagnostics.</p>
  `;
  documentObj.body.replaceChildren(message);
}

function initSettings(env: RendererEnvironment, api: AppApi): void {
  void reportRendererEvent(api, "settings.init");
  const statusEl = byId(env.document, "status");
  const resultsEl = byId(env.document, "settingsResults");
  const scanButton = byId<HTMLButtonElement>(env.document, "scanNow");
  const reviewButton = byId<HTMLButtonElement>(env.document, "reviewLobby");
  const screenshotPathEl = byId(env.document, "screenshotPath");
  const candidateCountEl = byId(env.document, "candidateCount");
  const encounterSummaryEl = byId(env.document, "encounterSummary");
  const updatedAtEl = byId(env.document, "updatedAt");
  const settingsMessageEl = byId(env.document, "settingsMessage");
  const calibrationStatusEl = byId(env.document, "calibrationStatus");
  let screenshotPath: string | undefined;

  byId(env.document, "calibrationView").hidden = true;
  byId(env.document, "overlayView").hidden = true;
  byId(env.document, "settingsView").hidden = false;

  void api.getSettings().then((settings) => {
    byId<HTMLSelectElement>(env.document, "server").value = settings.server;
    byId<HTMLInputElement>(env.document, "scanHotkey").value = settings.scanHotkey;
    byId<HTMLInputElement>(env.document, "captureMode").value = settings.captureMode;
    byId<HTMLSelectElement>(env.document, "overlayPosition").value = settings.overlayPosition;
  });

  byId<HTMLButtonElement>(env.document, "saveSettings").addEventListener("click", async () => {
    void reportClick(api, "settings.save");
    const settings = await api.saveSettings({
      server: byId<HTMLSelectElement>(env.document, "server").value as Region,
      scanHotkey: byId<HTMLInputElement>(env.document, "scanHotkey").value,
      captureMode: "foreground-window-display",
      overlayPosition: byId<HTMLSelectElement>(env.document, "overlayPosition").value as OverlayPosition
    });
    settingsMessageEl.textContent = `Saved ${settings.server} / ${settings.scanHotkey}`;
  });

  scanButton.addEventListener("click", async () => {
    void reportClick(api, "settings.scanNow");
    setBusy(scanButton, true, statusEl, "Scanning...");
    try {
      const output = await api.startScan();
      renderSummary(output, encounterSummaryEl, candidateCountEl, updatedAtEl);
      renderRows(env.document, output.summaries, resultsEl);
      setBusy(scanButton, false, statusEl, `Loaded ${output.summaries.length} character${output.summaries.length === 1 ? "" : "s"}`);
    } catch (error) {
      setBusy(scanButton, false, statusEl, errorMessage(error));
      void api.reportRendererError("settings.scanNow.failed", { message: errorMessage(error) });
    }
  });

  byId<HTMLButtonElement>(env.document, "showLastResults").addEventListener("click", async () => {
    void reportClick(api, "settings.showLastResults");
    const shown = await api.showLastResults();
    settingsMessageEl.textContent = shown ? "Showing last results" : "No scan results yet";
  });

  byId<HTMLButtonElement>(env.document, "openLogs").addEventListener("click", async () => {
    void reportClick(api, "settings.openLogs");
    try {
      const path = await api.openLogs();
      settingsMessageEl.textContent = `Opened logs: ${path}`;
    } catch (error) {
      settingsMessageEl.textContent = errorMessage(error);
    }
  });

  byId<HTMLButtonElement>(env.document, "chooseScreenshot").addEventListener("click", async () => {
    void reportClick(api, "settings.chooseScreenshot");
    screenshotPath = await api.chooseScreenshot();
    screenshotPathEl.textContent = screenshotPath ?? "";
  });

  installCalibrationButton(env.document, api, "calibrateLobbyRegion", "lobbyRegion", calibrationStatusEl);

  reviewButton.addEventListener("click", async () => {
    void reportClick(api, "settings.reviewLobby");
    setBusy(reviewButton, true, statusEl, "Reviewing lobby...");
    resultsEl.innerHTML = "";

    try {
      const output = await api.reviewLobby({
        region: byId<HTMLSelectElement>(env.document, "server").value as Region,
        visibleEncounterText: byId<HTMLInputElement>(env.document, "encounter").value,
        manualNames: byId<HTMLTextAreaElement>(env.document, "manualNames").value.split(/\r?\n|,/).map((name) => name.trim()).filter(Boolean),
        screenshotPath,
        useScreenshotOcr: byId<HTMLInputElement>(env.document, "useOcr").checked,
        pages: Number(byId<HTMLInputElement>(env.document, "pages").value) || 3
      });

      renderSummary(output, encounterSummaryEl, candidateCountEl, updatedAtEl);
      renderRows(env.document, output.summaries, resultsEl);
      setBusy(reviewButton, false, statusEl, `Loaded ${output.summaries.length} character${output.summaries.length === 1 ? "" : "s"}`);
    } catch (error) {
      setBusy(reviewButton, false, statusEl, errorMessage(error));
      void api.reportRendererError("settings.reviewLobby.failed", { message: errorMessage(error) });
      resultsEl.innerHTML = `<div class="empty">Review failed</div>`;
    }
  });
}

function initOverlay(env: RendererEnvironment, api: AppApi): void {
  const overlayView = byId(env.document, "overlayView");
  byId(env.document, "settingsView").hidden = true;
  byId(env.document, "calibrationView").hidden = true;
  overlayView.hidden = false;
  void reportRendererEvent(api, "overlay.init");

  byId<HTMLButtonElement>(env.document, "dismissOverlay").addEventListener("click", async () => {
    void reportClick(api, "overlay.dismiss");
    void reportRendererEvent(api, "overlay.dismiss.clicked");
    await api.dismissOverlay();
  });

  env.window.addEventListener("keydown", async (event) => {
    if (event.key !== "Escape") return;
    hideLogPopover(env.document);
    void reportRendererEvent(api, "overlay.dismiss.escape");
    await api.dismissOverlay();
  });

  overlayView.addEventListener("scroll", () => hideLogPopover(env.document));

  api.onScanResultUpdated((result) => {
    void reportRendererEvent(api, "overlay.result.received", {
      candidates: result.candidates.length,
      summaries: result.summaries.length,
      generatedAt: result.generatedAt
    });
    renderOverlayResult(env.document, api, result);
  });

  void renderLatestOverlayResult(env.document, api);
}

async function renderLatestOverlayResult(documentObj: Document, api: AppApi): Promise<void> {
  const result = await api.getLastResult();
  if (!result) return;
  renderOverlayResult(documentObj, api, result);
}

export function renderOverlayResult(documentObj: Document, api: AppApi, result: ScanResult): void {
  renderSummary(result, byId(documentObj, "overlayEncounter"), byId(documentObj, "overlayDetected"), byId(documentObj, "overlayUpdated"));
  byId(documentObj, "overlayStatus").textContent = (result.encounter.groupName ?? result.encounter.visibleText) || "Unknown encounter";
  renderWarnings(documentObj, result);
  renderRows(documentObj, result.summaries, byId(documentObj, "overlayResults"));
  void reportRendererEvent(api, "overlay.result.rendered", {
    candidates: result.candidates.length,
    summaries: result.summaries.length,
    warnings: result.warnings.length
  });
}

function renderSummary(
  output: Pick<ScanResult, "encounter" | "candidates" | "generatedAt">,
  encounterEl: HTMLElement,
  candidateCountEl: HTMLElement,
  updatedAtEl: HTMLElement
): void {
  encounterEl.textContent = (output.encounter.groupName ?? output.encounter.visibleText) || "Unknown";
  candidateCountEl.textContent = String(output.candidates.length);
  updatedAtEl.textContent = new Date(output.generatedAt).toLocaleTimeString();
}

function renderWarnings(documentObj: Document, result: ScanResult): void {
  const warningsEl = byId(documentObj, "overlayWarnings");
  warningsEl.replaceChildren(
    ...result.warnings.map((warning) => {
      const item = documentObj.createElement("div");
      item.textContent = warning;
      return item;
    })
  );
  warningsEl.hidden = result.warnings.length === 0;
}

function renderRows(documentObj: Document, summaries: ScanResult["summaries"], resultsEl: HTMLElement): void {
  if (summaries.length === 0) {
    resultsEl.innerHTML = `<div class="empty">No characters found</div>`;
    return;
  }

  resultsEl.replaceChildren(
    ...summaries.map((summary) => {
      const row = documentObj.createElement("article");
      row.className = "row";
      row.tabIndex = 0;
      row.innerHTML = `
        <div class="identity">
          <span class="name"></span>
          <div class="meta"></div>
          <div class="encounter-tag"></div>
          <div class="flags"></div>
          <div class="error"></div>
        </div>
        ${percentileMetric(summary)}
        ${performanceMetric(summary)}
        ${ndpsMetric(summary)}
      `;

      row.querySelector(".name")!.textContent = summary.name;
      row.querySelector(".meta")!.textContent = [summary.className, summary.spec, summary.gearScore ? `ilvl ${summary.gearScore}` : ""]
        .filter(Boolean)
        .join(" | ");
      row.querySelector(".encounter-tag")!.textContent = summary.selectedLog
        ? [summary.selectedLog.difficulty, summary.selectedLog.boss].filter(Boolean).join(" | ")
        : "";
      row.querySelector(".flags")!.textContent = summary.flags.join(" | ");
      row.querySelector(".error")!.textContent = summary.errorMessage ?? "";
      row.addEventListener("pointerenter", () => showLogPopover(documentObj, row, summary));
      row.addEventListener("focusin", () => showLogPopover(documentObj, row, summary));
      row.addEventListener("pointerleave", () => hideLogPopover(documentObj));
      row.addEventListener("focusout", () => hideLogPopover(documentObj));
      return row;
    })
  );
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function initCalibration(env: RendererEnvironment, api: AppApi): void {
  env.document.documentElement.classList.add("calibration-html");
  env.document.body.classList.add("calibration-body");
  byId(env.document, "settingsView").hidden = true;
  byId(env.document, "overlayView").hidden = true;
  const calibrationView = byId(env.document, "calibrationView");
  calibrationView.hidden = false;

  const params = new URLSearchParams(env.window.location.search);
  const target = params.get("target") as CalibrationTarget | null;
  if (!target) return;

  byId(env.document, "calibrationTitle").textContent = calibrationLabel(target);
  const selection = byId(env.document, "calibrationSelection");
  let start: { x: number; y: number } | undefined;

  calibrationView.addEventListener("pointerdown", (event) => {
    const pointer = event as PointerEvent;
    start = { x: pointer.clientX, y: pointer.clientY };
    selection.hidden = false;
    setSelection(selection, start.x, start.y, 0, 0);
  });

  calibrationView.addEventListener("pointermove", (event) => {
    if (!start) return;
    const pointer = event as PointerEvent;
    const rect = rectFromPoints(start.x, start.y, pointer.clientX, pointer.clientY);
    setSelection(selection, rect.x, rect.y, rect.width, rect.height);
  });

  calibrationView.addEventListener("pointerup", async (event) => {
    if (!start) return;
    const pointer = event as PointerEvent;
    const rect = rectFromPoints(start.x, start.y, pointer.clientX, pointer.clientY);
    start = undefined;
    await api.completeCalibration(target, rect);
  });

  env.window.addEventListener("keydown", async (event) => {
    if (event.key !== "Escape") return;
    await api.completeCalibration(target);
  });
}

function installCalibrationButton(
  documentObj: Document,
  api: AppApi,
  buttonId: string,
  target: CalibrationTarget,
  statusEl: HTMLElement
): void {
  byId<HTMLButtonElement>(documentObj, buttonId).addEventListener("click", async () => {
    statusEl.textContent = `Select ${calibrationLabel(target)}...`;
    try {
      const config = await api.startCalibration(target);
      statusEl.textContent = config
        ? `${calibrationLabel(target)} saved: ${formatRect(rectForCalibrationTarget(config, target))}`
        : "Calibration cancelled";
    } catch (error) {
      statusEl.textContent = errorMessage(error);
    }
  });
}

function calibrationLabel(target: CalibrationTarget): string {
  return {
    encounterTitle: "Encounter",
    applicantList: "Applicants",
    lobbyRegion: "Lobby Region",
    memberList: "Members",
    selectedLobbyRow: "Selected Row"
  }[target];
}

function rectFromPoints(startX: number, startY: number, endX: number, endY: number): { x: number; y: number; width: number; height: number } {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  return {
    x,
    y,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY)
  };
}

function setSelection(selection: HTMLElement, x: number, y: number, width: number, height: number): void {
  selection.style.left = `${x}px`;
  selection.style.top = `${y}px`;
  selection.style.width = `${width}px`;
  selection.style.height = `${height}px`;
}

function formatRect(rect: { x: number; y: number; width: number; height: number }): string {
  return `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
}

function rectForCalibrationTarget(config: Awaited<ReturnType<AppApi["getCalibration"]>>, target: CalibrationTarget): { x: number; y: number; width: number; height: number } {
  return target === "lobbyRegion" ? config.applicantList : config[target];
}

function percentileMetric(summary: ScanResult["summaries"][number]): string {
  const badges = summary.displayMetrics?.percentileBadges;
  if (!badges?.length) return metric("Percentile", formatPercent(summary.bestPercentile));
  return `
    <div class="metric percentile-metric">
      <span>Percentile</span>
      <strong class="badge-stack">${badges.map((badge) => `
        <b class="percentile-badge" style="background:${badge.backgroundColor}">${badge.label}</b>
      `).join("")}</strong>
    </div>
  `;
}

function performanceMetric(summary: ScanResult["summaries"][number]): string {
  const performance = summary.displayMetrics?.performance;
  if (!performance?.length) return metric("Performance", formatNumber(summary.bestDps));
  return `
    <div class="metric performance-metric">
      <span>Performance</span>
      <strong class="${summary.displayMetrics?.role === "support" ? "support-performance" : ""}">
        ${performance.map((entry) => `
          <b style="${entry.color ? `color:${entry.color}` : ""}">${entry.value}</b>
        `).join("")}
      </strong>
    </div>
  `;
}

function ndpsMetric(summary: ScanResult["summaries"][number]): string {
  const ndps = summary.displayMetrics?.ndps;
  if (!ndps) return metric("nDPS/uDPS", formatNumber(summary.medianNdps));
  return `
    <div class="metric">
      <span>nDPS/uDPS</span>
      <strong>${ndps.value}</strong>
    </div>
  `;
}

function showLogPopover(documentObj: Document, row: HTMLElement, summary: ScanResult["summaries"][number]): void {
  const popover = documentObj.getElementById("overlayLogPopover");
  if (!popover || summary.recentEncounterLogs.length === 0) return;

  popover.innerHTML = summary.recentEncounterLogs.map((log) => {
    const metrics = displayMetricsForLog(log);
    return `
      <div class="log-detail-row">
        <span>${escapeHtml(log.difficulty)} ${escapeHtml(log.boss)}</span>
        <span>${formatPercent(log.percentile)}</span>
        <span>${formatMetricEntries(metrics.performance)}</span>
        <span>${metrics.ndps.value}</span>
        <span>${formatDuration(log.duration)}</span>
        <span>${formatAge(log.timestamp)}</span>
      </div>
    `;
  }).join("");
  popover.hidden = false;
  positionLogPopover(documentObj, popover, row);
}

function hideLogPopover(documentObj: Document): void {
  const popover = documentObj.getElementById("overlayLogPopover");
  if (!popover) return;
  popover.hidden = true;
  popover.innerHTML = "";
}

function positionLogPopover(documentObj: Document, popover: HTMLElement, row: HTMLElement): void {
  const rowRect = row.getBoundingClientRect();
  const viewportWidth = documentObj.documentElement.clientWidth || 720;
  const viewportHeight = documentObj.documentElement.clientHeight || 760;
  const popoverWidth = Math.min(680, viewportWidth - 24);
  const popoverHeight = Math.min(220, Math.max(120, popover.scrollHeight || 120));
  const left = Math.max(12, Math.min(viewportWidth - popoverWidth - 12, rowRect.left));
  const below = rowRect.bottom + 6;
  const above = rowRect.top - popoverHeight - 6;
  const top = below + popoverHeight <= viewportHeight - 12 ? below : Math.max(12, above);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.width = `${popoverWidth}px`;
}

function displayMetricsForLog(log: LogEntry): CharacterDisplayMetrics {
  if (log.spec && SUPPORT_SPECS.has(log.spec)) {
    const buffs = log.buffs ?? [];
    return {
      role: "support",
      percentileBadges: [],
      performance: ["AP", "Brand", "Identity", "T"].map((label, index) => ({
        label,
        value: typeof buffs[index] === "number" ? `${Math.round(buffs[index] * 100)}` : "-",
        color: SUPPORT_PERFORMANCE_COLORS[index]
      })),
      ndps: {
        label: "rDPS",
        marker: "r",
        value: typeof log.rContribution === "number" ? `${(log.rContribution * 100).toFixed(1)}%` : "-"
      }
    };
  }

  return {
    role: "dps",
    percentileBadges: [],
    performance: [{ label: "DPS", value: formatNumber(log.dps) }],
    ndps: {
      label: typeof log.ndps === "number" ? "nDPS" : "uDPS",
      marker: typeof log.ndps === "number" ? "n" : typeof log.udps === "number" ? "u" : undefined,
      value: formatNumber(typeof log.ndps === "number" ? log.ndps : log.udps ?? null)
    }
  };
}

function formatMetricEntries(entries: SelectedLogMetric[]): string {
  return entries.map((entry) => entry.value).join("-");
}

function formatPercent(value: number | null): string {
  return value === null ? "-" : `${Math.floor(value * 100)}`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDuration(seconds: number): string {
  const totalSeconds = seconds > 3_600 ? seconds / 1000 : seconds;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = Math.max(0, Math.round(totalSeconds % 60));
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatAge(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  const days = Math.max(0, Math.floor(ageMs / 86_400_000));
  if (days >= 1) return `${days}d`;
  const hours = Math.max(0, Math.floor(ageMs / 3_600_000));
  return hours >= 1 ? `${hours}h` : "today";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setBusy(button: HTMLButtonElement, busy: boolean, statusEl: HTMLElement, status: string): void {
  button.disabled = busy;
  statusEl.textContent = status;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportClick(api: AppApi, action: string): Promise<void> {
  return reportRendererEvent(api, "button.click", { action });
}

function reportRendererEvent(api: AppApi, event: string, data?: Record<string, unknown>): Promise<void> {
  return api.reportRendererEvent(event, data).catch(() => undefined);
}

function byId<T extends HTMLElement = HTMLElement>(documentObj: Document, id: string): T {
  const element = documentObj.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bootRenderer();
}
