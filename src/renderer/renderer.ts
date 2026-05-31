import type { Region } from "../shared/types.js";
import type { ScanResult } from "../shared/appTypes.js";

const view = new URLSearchParams(window.location.search).get("view") ?? "settings";

if (view === "overlay") {
  initOverlay();
} else {
  initSettings();
}

window.addEventListener("error", (event) => {
  void window.loaLobbyLogs.reportRendererError("error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error instanceof Error ? event.error.stack ?? event.error.message : String(event.error)
  });
});

window.addEventListener("unhandledrejection", (event) => {
  void window.loaLobbyLogs.reportRendererError("unhandledrejection", {
    reason: event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason)
  });
});

function initSettings(): void {
  const statusEl = byId("status");
  const resultsEl = byId("settingsResults");
  const reviewButton = byId<HTMLButtonElement>("reviewLobby");
  const screenshotPathEl = byId("screenshotPath");
  const candidateCountEl = byId("candidateCount");
  const encounterSummaryEl = byId("encounterSummary");
  const updatedAtEl = byId("updatedAt");
  const settingsMessageEl = byId("settingsMessage");
  let screenshotPath: string | undefined;

  byId("overlayView").hidden = true;
  byId("settingsView").hidden = false;

  void window.loaLobbyLogs.getSettings().then((settings) => {
    byId<HTMLSelectElement>("server").value = settings.server;
    byId<HTMLInputElement>("scanHotkey").value = settings.scanHotkey;
    byId<HTMLInputElement>("captureMode").value = settings.captureMode;
  });

  byId<HTMLButtonElement>("saveSettings").addEventListener("click", async () => {
    const settings = await window.loaLobbyLogs.saveSettings({
      server: byId<HTMLSelectElement>("server").value as Region,
      scanHotkey: byId<HTMLInputElement>("scanHotkey").value,
      captureMode: "foreground-window-display",
      overlayPosition: "right"
    });
    settingsMessageEl.textContent = `Saved ${settings.server} / ${settings.scanHotkey}`;
  });

  byId<HTMLButtonElement>("scanNow").addEventListener("click", async () => {
    setBusy(reviewButton, true, statusEl, "Scanning...");
    try {
      const output = await window.loaLobbyLogs.startScan();
      renderSummary(output, encounterSummaryEl, candidateCountEl, updatedAtEl);
      renderRows(output.summaries, resultsEl);
      setBusy(reviewButton, false, statusEl, `Loaded ${output.summaries.length} character${output.summaries.length === 1 ? "" : "s"}`);
    } catch (error) {
      setBusy(reviewButton, false, statusEl, errorMessage(error));
    }
  });

  byId<HTMLButtonElement>("showLastResults").addEventListener("click", async () => {
    const shown = await window.loaLobbyLogs.showLastResults();
    settingsMessageEl.textContent = shown ? "Showing last results" : "No scan results yet";
  });

  byId<HTMLButtonElement>("openLogs").addEventListener("click", async () => {
    try {
      const path = await window.loaLobbyLogs.openLogs();
      settingsMessageEl.textContent = `Opened logs: ${path}`;
    } catch (error) {
      settingsMessageEl.textContent = errorMessage(error);
    }
  });

  byId<HTMLButtonElement>("chooseScreenshot").addEventListener("click", async () => {
    screenshotPath = await window.loaLobbyLogs.chooseScreenshot();
    screenshotPathEl.textContent = screenshotPath ?? "";
  });

  reviewButton.addEventListener("click", async () => {
    setBusy(reviewButton, true, statusEl, "Reviewing lobby...");
    resultsEl.innerHTML = "";

    try {
      const output = await window.loaLobbyLogs.reviewLobby({
        region: byId<HTMLSelectElement>("server").value as Region,
        visibleEncounterText: byId<HTMLInputElement>("encounter").value,
        manualNames: byId<HTMLTextAreaElement>("manualNames").value.split(/\r?\n|,/).map((name) => name.trim()).filter(Boolean),
        screenshotPath,
        useScreenshotOcr: byId<HTMLInputElement>("useOcr").checked,
        pages: Number(byId<HTMLInputElement>("pages").value) || 3
      });

      renderSummary(output, encounterSummaryEl, candidateCountEl, updatedAtEl);
      renderRows(output.summaries, resultsEl);
      setBusy(reviewButton, false, statusEl, `Loaded ${output.summaries.length} character${output.summaries.length === 1 ? "" : "s"}`);
    } catch (error) {
      setBusy(reviewButton, false, statusEl, errorMessage(error));
      resultsEl.innerHTML = `<div class="empty">Review failed</div>`;
    }
  });
}

function initOverlay(): void {
  const overlayView = byId("overlayView");
  byId("settingsView").hidden = true;
  overlayView.hidden = false;

  byId<HTMLButtonElement>("dismissOverlay").addEventListener("click", async () => {
    await window.loaLobbyLogs.dismissOverlay();
  });

  window.loaLobbyLogs.onScanResultUpdated(() => {
    void renderLatestOverlayResult();
  });

  void renderLatestOverlayResult();
}

async function renderLatestOverlayResult(): Promise<void> {
  const result = await window.loaLobbyLogs.getLastResult();
  if (!result) return;

  renderSummary(result, byId("overlayEncounter"), byId("overlayDetected"), byId("overlayUpdated"));
  byId("overlayStatus").textContent = (result.encounter.groupName ?? result.encounter.visibleText) || "Unknown encounter";
  renderWarnings(result);
  renderRows(result.summaries, byId("overlayResults"));
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

function renderWarnings(result: ScanResult): void {
  const warningsEl = byId("overlayWarnings");
  warningsEl.replaceChildren(
    ...result.warnings.map((warning) => {
      const item = document.createElement("div");
      item.textContent = warning;
      return item;
    })
  );
  warningsEl.hidden = result.warnings.length === 0;
}

function renderRows(summaries: Awaited<ReturnType<typeof window.loaLobbyLogs.reviewLobby>>["summaries"], resultsEl: HTMLElement): void {
  if (summaries.length === 0) {
    resultsEl.innerHTML = `<div class="empty">No characters found</div>`;
    return;
  }

  resultsEl.replaceChildren(
    ...summaries.map((summary) => {
      const row = document.createElement("article");
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

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}
