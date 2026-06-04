import type { Region } from "../shared/types.js";
import type { AppApi, OverlayPosition, ScanProgress, ScanResult } from "../shared/appTypes.js";
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
  const scanButton = byId<HTMLButtonElement>(env.document, "scanNow");
  const settingsMessageEl = byId(env.document, "settingsMessage");
  const calibrationStatusEl = byId(env.document, "calibrationStatus");

  byId(env.document, "calibrationView").hidden = true;
  byId(env.document, "overlayView").hidden = true;
  byId(env.document, "settingsView").hidden = false;

  void api.getSettings().then((settings) => {
    byId<HTMLSelectElement>(env.document, "server").value = settings.server;
    byId<HTMLInputElement>(env.document, "scanHotkey").value = settings.scanHotkey;
    byId<HTMLSelectElement>(env.document, "overlayPosition").value = settings.overlayPosition;
  });
  installHotkeyCapture(byId<HTMLInputElement>(env.document, "scanHotkey"));
  void refreshCalibrationStatus(env.document, api);

  byId<HTMLButtonElement>(env.document, "saveSettings").addEventListener("click", async () => {
    void reportClick(api, "settings.save");
    const settings = await api.saveSettings({
      server: byId<HTMLSelectElement>(env.document, "server").value as Region,
      scanHotkey: byId<HTMLInputElement>(env.document, "scanHotkey").value,
      captureMode: "foreground-window-display",
      overlayPosition: byId<HTMLSelectElement>(env.document, "overlayPosition").value as OverlayPosition
    });
    settingsMessageEl.textContent = `Saved ${settings.server} / ${settings.scanHotkey} / Overlay ${settings.overlayPosition}`;
  });

  scanButton.addEventListener("click", async () => {
    void reportClick(api, "settings.scanNow");
    setBusy(scanButton, true, statusEl, "Scanning...");
    try {
      const output = await api.startScan();
      setBusy(scanButton, false, statusEl, output ? `Loaded ${output.summaries.length} character${output.summaries.length === 1 ? "" : "s"}` : "Calibration required");
    } catch (error) {
      setBusy(scanButton, false, statusEl, errorMessage(error));
      void api.reportRendererError("settings.scanNow.failed", { message: errorMessage(error) });
    }
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

  installCalibrationButton(env.document, api, "calibrateEncounterTitle", "encounterTitle", calibrationStatusEl);
  installCalibrationButton(env.document, api, "calibrateCharacterList", "characterList", calibrationStatusEl);
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
    clearOverlayView(env.document);
    await api.dismissOverlay();
  });

  byId<HTMLButtonElement>(env.document, "openSettingsFromOverlay").addEventListener("click", async () => {
    void reportClick(api, "overlay.openSettings");
    await api.openSettings();
  });

  env.window.addEventListener("keydown", async (event) => {
    if (event.key !== "Escape") return;
    clearOverlayView(env.document);
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

  api.onScanProgressUpdated((progress) => {
    renderOverlayProgress(env.document, progress);
  });
}

export function renderOverlayResult(documentObj: Document, api: AppApi, result: ScanResult): void {
  setOverlayResultsVisible(documentObj, true);
  hideOverlayProgress(documentObj);
  renderSummary(result, byId(documentObj, "overlayEncounter"), byId(documentObj, "overlayDetected"), byId(documentObj, "overlayUpdated"));
  byId(documentObj, "overlayStatus").textContent = "";
  renderWarnings(documentObj, result);
  renderRows(documentObj, result.summaries, result.encounter, byId(documentObj, "overlayResults"));
  void reportRendererEvent(api, "overlay.result.rendered", {
    candidates: result.candidates.length,
    summaries: result.summaries.length,
    warnings: result.warnings.length
  });
}

function renderOverlayProgress(documentObj: Document, progress: ScanProgress): void {
  if (progress.stage === "capturing" && progress.message.toLowerCase().includes("preparing")) {
    clearOverlayView(documentObj, "Scanning...");
  }
  setOverlayResultsVisible(documentObj, false);
  const progressEl = byId(documentObj, "overlayProgress");
  const titleEl = byId(documentObj, "overlayProgressTitle");
  const messageEl = byId(documentObj, "overlayProgressMessage");
  const settingsButton = byId<HTMLButtonElement>(documentObj, "openSettingsFromOverlay");
  byId(documentObj, "overlayStatus").textContent = progress.message;
  progressEl.hidden = progress.stage !== "needs-calibration";
  titleEl.textContent = progress.stage === "needs-calibration"
    ? "Calibration Required"
    : progress.stage === "error"
      ? "Scan Failed"
      : "Scanning";
  messageEl.textContent = progress.message;
  settingsButton.hidden = progress.stage !== "needs-calibration";
  if (progress.stage !== "needs-calibration") {
    byId(documentObj, "overlayWarnings").hidden = true;
  }
}

function clearOverlayView(documentObj: Document, status = "No results yet"): void {
  hideLogPopover(documentObj);
  hideOverlayProgress(documentObj);
  setOverlayResultsVisible(documentObj, true);
  byId(documentObj, "overlayWarnings").replaceChildren();
  byId(documentObj, "overlayWarnings").hidden = true;
  byId(documentObj, "overlayResults").replaceChildren();
  byId(documentObj, "overlayStatus").textContent = status;
  byId(documentObj, "overlayEncounter").textContent = "Unknown";
  byId(documentObj, "overlayDetected").textContent = "0";
  byId(documentObj, "overlayUpdated").textContent = "Never";
}

function hideOverlayProgress(documentObj: Document): void {
  byId(documentObj, "overlayProgress").hidden = true;
  byId<HTMLButtonElement>(documentObj, "openSettingsFromOverlay").hidden = true;
}

function setOverlayResultsVisible(documentObj: Document, visible: boolean): void {
  byId(documentObj, "overlaySummary").hidden = !visible;
  byId(documentObj, "overlayResultsFrame").hidden = !visible;
}

function renderSummary(
  output: Pick<ScanResult, "encounter" | "candidates" | "generatedAt">,
  encounterEl: HTMLElement,
  candidateCountEl: HTMLElement,
  updatedAtEl: HTMLElement
): void {
  encounterEl.textContent = output.encounter.visibleText || output.encounter.groupName || "Unknown";
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

function renderRows(
  documentObj: Document,
  summaries: ScanResult["summaries"],
  encounter: ScanResult["encounter"],
  resultsEl: HTMLElement
): void {
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
          <div class="identity-heading">
            <span class="name"></span>
          </div>
          <div class="meta"></div>
          <div class="encounter-tag"></div>
          <div class="lookup-message"></div>
        </div>
        ${percentileMetric(summary)}
        ${performanceMetric(summary)}
        ${ndpsMetric(summary)}
      `;

      row.querySelector(".name")!.textContent = summary.name;
      row.querySelector(".meta")!.textContent = [
        summary.className,
        summary.spec,
        typeof summary.gearScore === "number" ? `ilvl ${formatItemLevel(summary.gearScore)}` : "",
        typeof summary.combatPower === "number" ? `CP ${formatCombatPower(summary.combatPower)}` : ""
      ]
        .filter(Boolean)
        .join(" | ");
      row.querySelector(".encounter-tag")!.textContent = summary.selectedLog
        ? encounterTagText(summary)
        : "";
      row.querySelector(".encounter-tag")!.className = ["encounter-tag", summary.flags.includes("no-encounter-match") && summary.selectedLog ? "fallback-log" : ""].filter(Boolean).join(" ");
      const lookup = friendlyLookupMessage(summary, encounter);
      const lookupEl = row.querySelector(".lookup-message")!;
      lookupEl.textContent = lookup.text;
      lookupEl.className = ["lookup-message", lookup.className].filter(Boolean).join(" ");
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

function encounterTagText(summary: ScanResult["summaries"][number]): string {
  if (!summary.selectedLog) return "";
  const text = [summary.selectedLog.difficulty, gateForBoss(summary.selectedLog.boss), summary.selectedLog.boss].filter(Boolean).join(" | ");
  return summary.flags.includes("no-encounter-match") ? `⚠ ${text}` : text;
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
        ? `${calibrationLabel(target)} saved`
        : "Calibration cancelled";
      await refreshCalibrationStatus(documentObj, api);
    } catch (error) {
      statusEl.textContent = errorMessage(error);
    }
  });
}

async function refreshCalibrationStatus(documentObj: Document, api: AppApi): Promise<void> {
  const statusEl = byId(documentObj, "calibrationStatus");
  try {
    const status = await api.getCalibrationStatus();
    statusEl.replaceChildren(...calibrationStatusElements(documentObj, status));
  } catch (error) {
    statusEl.replaceChildren();
    statusEl.textContent = errorMessage(error);
  }
}

function calibrationLabel(target: CalibrationTarget): string {
  return {
    encounterTitle: "Encounter",
    characterList: "Characters"
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

function calibrationStatusElements(
  documentObj: Document,
  status: Awaited<ReturnType<AppApi["getCalibrationStatus"]>>
): HTMLElement[] {
  return [
    calibrationStatusItem(documentObj, "Encounter Title", status.config.encounterTitle ? formatRect(status.config.encounterTitle) : "Unset"),
    calibrationStatusItem(documentObj, "Character List", status.config.characterList ? formatRect(status.config.characterList) : "Unset")
  ];
}

function calibrationStatusItem(documentObj: Document, label: string, value: string): HTMLElement {
  const item = documentObj.createElement("span");
  item.className = "calibration-status-item";
  const labelEl = documentObj.createElement("span");
  labelEl.className = "calibration-status-label";
  labelEl.textContent = label;
  const valueEl = documentObj.createElement("span");
  valueEl.className = "calibration-status-value";
  valueEl.textContent = value;
  item.replaceChildren(labelEl, valueEl);
  return item;
}

function formatRect(rect: { x: number; y: number; width: number; height: number }): string {
  return `${rect.x}, ${rect.y}, ${rect.width} x ${rect.height}`;
}

function percentileMetric(summary: ScanResult["summaries"][number]): string {
  const badges = summary.displayMetrics?.percentileBadges;
  if (!badges?.length) return metric("Percentile", percentileTextHtml(summary.bestPercentile));
  return `
    <div class="metric percentile-metric">
      <span>Percentile</span>
      <strong class="percentile-values">${badges.map((badge) => `
        <b style="color:${badge.textColor}">${badge.label}</b>
      `).join(supportPercentileDivider())}</strong>
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
        ${formatPerformanceEntriesHtml(performance, summary.displayMetrics?.role === "support")}
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

  const role = summary.displayMetrics?.role ?? "dps";
  popover.innerHTML = `
    <div class="log-detail-row header">
      <strong>Encounter</strong>
      <strong>${role === "support" ? "Percentiles" : "Percentile"}</strong>
      <strong>${role === "support" ? "AP / Brand / Identity / T" : "DPS"}</strong>
      <strong>${role === "support" ? "rDPS" : "nDPS/uDPS"}</strong>
      <strong>Duration</strong>
      <strong>Cleared</strong>
    </div>
    ${summary.recentEncounterLogs.map((log) => {
    const metrics = displayMetricsForLog(log);
    return `
      <div class="log-detail-row">
        <span class="encounter-cell">${difficultyChip(log.difficulty)}${gateChip(log.boss)}<span>${escapeHtml(log.boss)}</span></span>
        <span class="popover-percentiles">${metrics.role === "support" ? formatSupportPercentileTexts(log) : percentileTextHtml(log.percentile)}</span>
        <span class="${metrics.role === "support" ? "support-performance" : ""}">${formatPerformanceEntriesHtml(metrics.performance, metrics.role === "support")}</span>
        <span>${metrics.ndps.value}</span>
        <span>${formatDuration(log.duration)}</span>
        <span>${formatAge(log.timestamp)}</span>
      </div>
    `;
  }).join("")}`;
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
  const measuredHeight = popover.getBoundingClientRect().height || popover.scrollHeight || 120;
  const popoverHeight = Math.min(220, Math.max(60, measuredHeight));
  const left = Math.max(12, Math.min(viewportWidth - popoverWidth - 12, rowRect.left));
  const below = rowRect.bottom + 6;
  const above = rowRect.top - popoverHeight - 6;
  const top = below + popoverHeight <= viewportHeight - 12 ? below : Math.max(12, above);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.width = `${popoverWidth}px`;
}

function formatItemLevel(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, useGrouping: false }).format(value);
}

function formatCombatPower(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function installHotkeyCapture(input: HTMLInputElement): void {
  let listening = false;
  let previousValue = input.value;
  input.readOnly = true;
  input.title = "Click, then press a hotkey";

  const startListening = () => {
    if (listening) return;
    listening = true;
    previousValue = input.value;
    input.value = "Press hotkey...";
  };

  input.addEventListener("focus", startListening);
  input.addEventListener("click", startListening);
  input.addEventListener("keydown", (event) => {
    if (!listening) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      input.value = previousValue;
      listening = false;
      input.blur();
      return;
    }

    const key = captureKeyName(event.key);
    if (!key) return;
    const modifiers = [
      event.ctrlKey ? "Ctrl" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      event.metaKey ? "Command" : ""
    ].filter(Boolean);
    input.value = [...modifiers, key].join("+");
    listening = false;
    input.blur();
  });
}

function captureKeyName(key: string): string | undefined {
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return undefined;
  if (key === " ") return "Space";
  if (key === "+") return "Plus";
  if (/^Arrow/.test(key)) return key.replace(/^Arrow/, "");
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function difficultyChip(difficulty: string): string {
  const className = difficulty.trim().toLowerCase().replace(/\s+/g, "-");
  return `<b class="difficulty-chip ${escapeHtml(className)}">${escapeHtml(difficulty)}</b>`;
}

function gateChip(boss: string): string {
  const gate = gateForBoss(boss);
  return gate ? `<b class="gate-chip">${escapeHtml(gate)}</b>` : "";
}

function gateForBoss(boss: string): string | undefined {
  const gates: Record<string, string> = {
    "Witch of Agony, Serca": "G1",
    "Corvus Tul Rak": "G2",
    "Brelshaza, Ember in the Ashes": "G1",
    "Armoche, Sentinel of the Abyss": "G2",
    Infernas: "G1",
    "Blossoming Fear, Naitreya": "G2",
    "Flash of Punishment": "G3",
    "Abyss Lord Kazeros": "G1",
    "Archdemon Kazeros": "G2",
    "Death Incarnate Kazeros": "G2"
  };
  return gates[boss];
}

function formatSupportPercentileTexts(log: LogEntry): string {
  return `${percentileTextHtml(log.contributionPercentile ?? null)}${supportPercentileDivider()}${percentileTextHtml(log.percentile)}`;
}

function supportPercentileDivider(): string {
  return '<span class="support-percentile-divider" aria-hidden="true"></span>';
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

function formatPerformanceEntriesHtml(entries: SelectedLogMetric[], dotted: boolean): string {
  const separator = dotted ? '<span class="performance-separator">·</span>' : "";
  return entries.map((entry) => `
    <b style="${entry.color ? `color:${entry.color}` : ""}">${entry.value}</b>
  `).join(separator);
}

function formatPercent(value: number | null): string {
  return value === null ? "-" : `${Math.floor(value * 100)}`;
}

function percentileTextHtml(value: number | null): string {
  if (value === null) return "-";
  const label = formatPercent(value);
  return `<b style="color:${percentileTextColor(value)}">${label}</b>`;
}

function percentileTextColor(value: number): string {
  const percentile = Math.floor(value * 100);
  if (percentile === 100) return "#dcc999";
  if (percentile === 99) return "#FF69B4";
  if (percentile >= 95) return "#FFA441";
  if (percentile >= 75) return "#ce84ff";
  if (percentile >= 50) return "#0096ff";
  if (percentile >= 25) return "#3dd351";
  return "#afafaf";
}

function friendlyLookupMessage(
  summary: ScanResult["summaries"][number],
  encounter: ScanResult["encounter"]
): { text: string; className?: string } {
  if (summary.flags.includes("no-encounter-match") && summary.selectedLog) {
    return { text: "" };
  }
  if (summary.selectedLog) return { text: "" };
  if (
    summary.flags.includes("character-not-found") ||
    summary.errorMessage?.toLowerCase().includes("not found")
  ) {
    return { text: `Character ${summary.name} was not found`, className: "character-not-found" };
  }
  if (
    (summary.flags.includes("no-public-logs") && !summary.flags.includes("scrape-failed")) ||
    summary.errorMessage?.toLowerCase().includes("does not have public")
  ) {
    return { text: `Character ${summary.name} does not have public logs`, className: "no-public-logs" };
  }
  if (summary.errorMessage || summary.flags.includes("scrape-failed")) {
    return { text: `Could not load logs for ${summary.name}`, className: "load-failed" };
  }
  return { text: "" };
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
