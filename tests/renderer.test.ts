import { describe, expect, it } from "vitest";
import { bootRenderer } from "../src/renderer/renderer.js";
import type { AppApi, AppSettings, ScanResult } from "../src/shared/appTypes.js";

class FakeElement {
  readonly listeners = new Map<string, Array<(event?: any) => unknown>>();
  readonly children: FakeElement[] = [];
  className = "";
  hidden = false;
  textContent = "";
  value = "";
  checked = false;
  disabled = false;
  private html = "";

  constructor(readonly tagName = "div", readonly id = "") {}

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
    this.children.length = 0;

    for (const className of ["identity", "name", "meta", "flags", "error", "metric", "empty"]) {
      if (!value.includes(`class="${className}"`)) continue;
      const child = new FakeElement("div");
      child.className = className;
      this.children.push(child);
    }
  }

  addEventListener(event: string, listener: (event?: any) => unknown): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  async trigger(event: string): Promise<void> {
    await Promise.all((this.listeners.get(event) ?? []).map((listener) => listener({ type: event })));
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...children);
    this.html = "";
  }

  querySelector(selector: string): FakeElement | undefined {
    const className = selector.startsWith(".") ? selector.slice(1) : selector;
    return this.find((element) => element.className.split(/\s+/).includes(className));
  }

  private find(predicate: (element: FakeElement) => boolean): FakeElement | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return undefined;
  }
}

class FakeDocument {
  readonly body = new FakeElement("body");
  private readonly elements = new Map<string, FakeElement>();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.elements.set(id, new FakeElement("div", id));
    }
  }

  getElementById(id: string): FakeElement | undefined {
    return this.elements.get(id);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

class FakeWindow {
  readonly listeners = new Map<string, Array<(event?: any) => unknown>>();
  loaLobbyLogs?: AppApi;

  constructor(readonly location: { href: string; search: string }) {}

  addEventListener(event: string, listener: (event?: any) => unknown): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
}

const overlayIds = [
  "settingsView",
  "overlayView",
  "dismissOverlay",
  "overlayEncounter",
  "overlayDetected",
  "overlayUpdated",
  "overlayStatus",
  "overlayWarnings",
  "overlayResults"
];

const settingsIds = [
  "settingsView",
  "overlayView",
  "status",
  "settingsResults",
  "scanNow",
  "reviewLobby",
  "screenshotPath",
  "candidateCount",
  "encounterSummary",
  "updatedAt",
  "settingsMessage",
  "server",
  "scanHotkey",
  "captureMode",
  "saveSettings",
  "showLastResults",
  "openLogs",
  "chooseScreenshot",
  "encounter",
  "manualNames",
  "useOcr",
  "pages"
];

describe("renderer boot", () => {
  it("renders a visible preload failure instead of crashing silently", () => {
    const document = new FakeDocument([]);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });

    expect(document.body.children).toHaveLength(1);
    expect(document.body.children[0].className).toBe("fatal-error");
    expect(document.body.children[0].innerHTML).toContain("preload API is unavailable");
  });

  it("wires the overlay dismiss button and renders scan result rows", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    await document.getElementById("dismissOverlay")!.trigger("click");
    api.emitScanResult(scanResult());
    await flushPromises();

    expect(api.events.map((event) => event.event)).toContain("boot.start");
    expect(api.events.map((event) => event.event)).toContain("overlay.init");
    expect(api.events).toContainEqual({ event: "button.click", data: { action: "overlay.dismiss" } });
    expect(api.dismissOverlayCalls).toBe(1);
    expect(document.getElementById("overlayDetected")!.textContent).toBe("1");
    expect(document.getElementById("overlayStatus")!.textContent).toBe("Dark Baratron");
    expect(document.getElementById("overlayResults")!.children).toHaveLength(1);
    expect(document.getElementById("overlayResults")!.children[0].querySelector(".name")?.textContent).toBe("Pepegami");
    expect(api.events.map((event) => event.event)).toContain("overlay.result.rendered");
  });

  it("wires settings buttons to their expected APIs", async () => {
    const document = new FakeDocument(settingsIds);
    const window = new FakeWindow({ href: "app://index.html?view=settings", search: "?view=settings" });
    const api = createApi();
    window.loaLobbyLogs = api;
    document.getElementById("server")!.value = "NA";
    document.getElementById("scanHotkey")!.value = "Ctrl+Alt+D";
    document.getElementById("encounter")!.value = "[Normal]Dark Baratron";
    document.getElementById("manualNames")!.value = "Pepegami";
    document.getElementById("pages")!.value = "3";

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    await document.getElementById("saveSettings")!.trigger("click");
    await document.getElementById("scanNow")!.trigger("click");
    await document.getElementById("reviewLobby")!.trigger("click");

    expect(api.saveSettingsCalls).toBe(1);
    expect(api.startScanCalls).toBe(1);
    expect(api.reviewLobbyCalls).toBe(1);
    expect(api.events).toContainEqual({ event: "button.click", data: { action: "settings.save" } });
    expect(api.events).toContainEqual({ event: "button.click", data: { action: "settings.scanNow" } });
    expect(api.events).toContainEqual({ event: "button.click", data: { action: "settings.reviewLobby" } });
  });
});

function createApi(): AppApi & {
  readonly events: Array<{ event: string; data?: Record<string, unknown> }>;
  dismissOverlayCalls: number;
  saveSettingsCalls: number;
  startScanCalls: number;
  reviewLobbyCalls: number;
  emitScanResult(result: ScanResult): void;
} {
  const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
  const listeners: Array<(result: ScanResult) => void> = [];
  const settings: AppSettings = {
    server: "NA",
    scanHotkey: "Ctrl+Alt+D",
    captureMode: "foreground-window-display",
    overlayPosition: "right"
  };

  const api: AppApi & {
    readonly events: Array<{ event: string; data?: Record<string, unknown> }>;
    dismissOverlayCalls: number;
    saveSettingsCalls: number;
    startScanCalls: number;
    reviewLobbyCalls: number;
    emitScanResult(result: ScanResult): void;
  } = {
    events,
    dismissOverlayCalls: 0,
    saveSettingsCalls: 0,
    startScanCalls: 0,
    reviewLobbyCalls: 0,
    reviewLobby: async () => {
      api.reviewLobbyCalls += 1;
      return scanResult();
    },
    startScan: async () => {
      api.startScanCalls += 1;
      return scanResult();
    },
    getLastResult: async () => undefined,
    onScanResultUpdated: (callback) => {
      listeners.push(callback);
      return () => undefined;
    },
    showLastResults: async () => true,
    dismissOverlay: async () => {
      api.dismissOverlayCalls += 1;
    },
    getSettings: async () => settings,
    saveSettings: async () => {
      api.saveSettingsCalls += 1;
      return settings;
    },
    openLogs: async () => "diagnostics.jsonl",
    reportRendererEvent: async (event, data) => {
      events.push({ event, ...(data ? { data } : {}) });
    },
    reportRendererError: async (event, data) => {
      events.push({ event, data });
    },
    runScreenshotOcr: async () => [],
    chooseScreenshot: async () => "screenshot.png",
    getCalibration: async () => ({
      version: 1,
      encounterTitle: { x: 0, y: 0, width: 1, height: 1 },
      applicantList: { x: 0, y: 0, width: 1, height: 1 },
      memberList: { x: 0, y: 0, width: 1, height: 1 },
      selectedLobbyRow: { x: 0, y: 0, width: 1, height: 1 }
    }),
    saveCalibration: async (config) => config,
    setAlwaysOnTop: async () => true,
    emitScanResult: (result) => {
      for (const listener of listeners) listener(result);
    }
  };

  return api;
}

function scanResult(): ScanResult {
  return {
    encounter: { visibleText: "Dark Baratron", groupName: "Dark Baratron", bosses: ["Dark Baratron"] },
    candidates: [{
      rawText: "Pepegami",
      normalizedName: "Pepegami",
      confidence: 0.9,
      sourceMode: "other-party-selected-lobby",
      cropRect: { x: 0, y: 0, width: 1, height: 1 }
    }],
    summaries: [{
      name: "Pepegami",
      className: "Sorceress",
      spec: "Igniter",
      gearScore: 1765,
      currentEncounterLogs: [],
      recentOtherLogs: [],
      bestPercentile: 0.99,
      medianPercentile: 0.95,
      bestDps: 1_077_347_781,
      medianDps: 900_000_000,
      medianNdps: 306_477_091,
      latestTimestamp: 1,
      flags: []
    }],
    generatedAt: "2026-05-31T04:41:02.660Z",
    warnings: []
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
