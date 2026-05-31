import type { Region } from "../shared/types.js";
import type { AppApi, ScanResult } from "../shared/appTypes.js";

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
  let screenshotPath: string | undefined;

  byId(env.document, "overlayView").hidden = true;
  byId(env.document, "settingsView").hidden = false;

  void api.getSettings().then((settings) => {
    byId<HTMLSelectElement>(env.document, "server").value = settings.server;
    byId<HTMLInputElement>(env.document, "scanHotkey").value = settings.scanHotkey;
    byId<HTMLInputElement>(env.document, "captureMode").value = settings.captureMode;
  });

  byId<HTMLButtonElement>(env.document, "saveSettings").addEventListener("click", async () => {
    void reportClick(api, "settings.save");
    const settings = await api.saveSettings({
      server: byId<HTMLSelectElement>(env.document, "server").value as Region,
      scanHotkey: byId<HTMLInputElement>(env.document, "scanHotkey").value,
      captureMode: "foreground-window-display",
      overlayPosition: "right"
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
  overlayView.hidden = false;
  void reportRendererEvent(api, "overlay.init");

  byId<HTMLButtonElement>(env.document, "dismissOverlay").addEventListener("click", async () => {
    void reportClick(api, "overlay.dismiss");
    void reportRendererEvent(api, "overlay.dismiss.clicked");
    await api.dismissOverlay();
  });

  env.window.addEventListener("keydown", async (event) => {
    if (event.key !== "Escape") return;
    void reportRendererEvent(api, "overlay.dismiss.escape");
    await api.dismissOverlay();
  });

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
      row.innerHTML = `
        <div class="identity">
          <span class="name"></span>
          <div class="meta"></div>
          <div class="flags"></div>
          <div class="error"></div>
        </div>
        ${metric("Pct", formatPercent(summary.bestPercentile))}
        ${metric("DPS", formatNumber(summary.bestDps))}
        ${metric("nDPS", formatNumber(summary.medianNdps))}
      `;

      row.querySelector(".name")!.textContent = summary.name;
      row.querySelector(".meta")!.textContent = [summary.className, summary.spec, summary.gearScore ? `ilvl ${summary.gearScore}` : ""]
        .filter(Boolean)
        .join(" | ");
      row.querySelector(".flags")!.textContent = summary.flags.join(" | ");
      row.querySelector(".error")!.textContent = summary.errorMessage ?? "";
      return row;
    })
  );
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function formatPercent(value: number | null): string {
  return value === null ? "-" : `${Math.round(value * 100)}`;
}

function formatNumber(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
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
