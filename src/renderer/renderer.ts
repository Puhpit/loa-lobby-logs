import type { Region } from "../shared/types.js";

const statusEl = byId("status");
const resultsEl = byId("results");
const reviewButton = byId<HTMLButtonElement>("reviewLobby");
const screenshotPathEl = byId("screenshotPath");
const candidateCountEl = byId("candidateCount");
const encounterSummaryEl = byId("encounterSummary");
const updatedAtEl = byId("updatedAt");

let screenshotPath: string | undefined;

byId<HTMLButtonElement>("chooseScreenshot").addEventListener("click", async () => {
  screenshotPath = await window.loaLobbyLogs.chooseScreenshot();
  screenshotPathEl.textContent = screenshotPath ?? "";
});

byId<HTMLInputElement>("alwaysOnTop").addEventListener("change", async (event) => {
  await window.loaLobbyLogs.setAlwaysOnTop((event.target as HTMLInputElement).checked);
});

reviewButton.addEventListener("click", async () => {
  setBusy(true, "Reviewing lobby...");
  resultsEl.innerHTML = "";

  try {
    const output = await window.loaLobbyLogs.reviewLobby({
      region: byId<HTMLSelectElement>("region").value as Region,
      visibleEncounterText: byId<HTMLInputElement>("encounter").value,
      manualNames: byId<HTMLTextAreaElement>("manualNames").value.split(/\r?\n|,/).map((name) => name.trim()).filter(Boolean),
      screenshotPath,
      useScreenshotOcr: byId<HTMLInputElement>("useOcr").checked,
      pages: Number(byId<HTMLInputElement>("pages").value) || 3
    });

    encounterSummaryEl.textContent = (output.encounter.groupName ?? output.encounter.visibleText) || "Unknown";
    candidateCountEl.textContent = String(output.candidates.length);
    updatedAtEl.textContent = new Date(output.generatedAt).toLocaleTimeString();
    renderRows(output.summaries);
    setBusy(false, `Loaded ${output.summaries.length} character${output.summaries.length === 1 ? "" : "s"}`);
  } catch (error) {
    setBusy(false, error instanceof Error ? error.message : String(error));
    resultsEl.innerHTML = `<div class="empty">Review failed</div>`;
  }
});

function renderRows(summaries: Awaited<ReturnType<typeof window.loaLobbyLogs.reviewLobby>>["summaries"]): void {
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
        </div>
        ${metric("Pct", formatPercent(summary.bestPercentile))}
        ${metric("DPS", formatNumber(summary.bestDps))}
        ${metric("nDPS", formatNumber(summary.medianNdps))}
      `;

      row.querySelector(".name")!.textContent = summary.name;
      row.querySelector(".meta")!.textContent = [summary.className, summary.spec, summary.gearScore ? `ilvl ${summary.gearScore}` : ""]
        .filter(Boolean)
        .join(" · ");
      row.querySelector(".flags")!.textContent = summary.flags.join(" · ");
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

function setBusy(busy: boolean, status: string): void {
  reviewButton.disabled = busy;
  statusEl.textContent = status;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}
