import { describe, expect, it } from "vitest";
import { bootRenderer } from "../src/renderer/renderer.js";
import type { AppApi, AppSettings, ScanProgress, ScanResult } from "../src/shared/appTypes.js";

class FakeElement {
  readonly listeners = new Map<string, Array<(event?: any) => unknown>>();
  readonly children: FakeElement[] = [];
  className = "";
  readonly classList = {
    add: (...classNames: string[]) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const className of classNames) names.add(className);
      this.className = [...names].join(" ");
    },
    remove: (...classNames: string[]) => {
      const removeNames = new Set(classNames);
      this.className = this.className.split(/\s+/).filter((name) => !removeNames.has(name)).join(" ");
    }
  };
  hidden = false;
  textContent = "";
  value = "";
  checked = false;
  disabled = false;
  readOnly = false;
  tabIndex = -1;
  title = "";
  clientWidth = 720;
  clientHeight = 760;
  scrollHeight = 120;
  style: Record<string, string> = {};
  private html = "";

  constructor(readonly tagName = "div", readonly id = "") {}

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
    this.children.length = 0;

    for (const className of ["identity", "identity-heading", "name", "meta", "encounter-tag", "lookup-message", "metric", "empty", "log-detail-row"]) {
      if (!value.includes(`class="${className}`)) continue;
      const child = new FakeElement("div");
      child.className = className;
      this.children.push(child);
    }
  }

  addEventListener(event: string, listener: (event?: any) => unknown): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  async trigger(event: string, data: Record<string, unknown> = {}): Promise<void> {
    const eventData = {
      type: event,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      ...data
    };
    await Promise.all((this.listeners.get(event) ?? []).map((listener) => listener(eventData)));
  }

  blur(): void {}

  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...children);
    this.html = "";
    this.textContent = children.map((child) => child.textContent).join("");
  }

  querySelector(selector: string): FakeElement | undefined {
    const className = selector.startsWith(".") ? selector.slice(1) : selector;
    return this.find((element) => element.className.split(/\s+/).includes(className));
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      right: 690,
      bottom: 82,
      width: 680,
      height: 72,
      toJSON: () => ({})
    } as DOMRect;
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
  readonly documentElement = new FakeElement("html");
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
  "calibrationView",
  "overlayView",
  "dismissOverlay",
  "overlaySummary",
  "overlayEncounter",
  "overlayDetected",
  "overlayUpdated",
  "overlayStatus",
  "overlayWarnings",
  "overlayResultsFrame",
  "overlayResultsHeader",
  "overlayResults",
  "overlayLogPopover",
  "overlayProgress",
  "overlayProgressTitle",
  "overlayProgressMessage",
  "openSettingsFromOverlay"
];

const settingsIds = [
  "settingsView",
  "calibrationView",
  "overlayView",
  "status",
  "scanNow",
  "settingsMessage",
  "server",
  "scanHotkey",
  "overlayPosition",
  "saveSettings",
  "openLogs",
  "calibrationStatus",
  "calibrateEncounterTitle",
  "calibrateCharacterList"
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
    expect(document.getElementById("overlayStatus")!.textContent).toBe("");
    expect(document.getElementById("overlayResults")!.children).toHaveLength(1);
    const row = document.getElementById("overlayResults")!.children[0];
    expect(row.querySelector(".name")?.textContent).toBe("Pepegami");
    expect(row.querySelector(".meta")?.textContent).toContain("ilvl 1765.33 | CP 5,216.71");
    expect(row.innerHTML).toContain("nDPS/uDPS");
    expect(row.innerHTML).toContain("color:#FF69B4");
    expect(row.innerHTML).toContain(">99</b>");
    expect(row.innerHTML).not.toContain("percentile-badge");
    expect(row.innerHTML).not.toContain("ocr-uncertain");
    expect(row.innerHTML).not.toContain("scrape-failed");
    expect(row.innerHTML).not.toContain("log-details");
    expect(api.events.map((event) => event.event)).toContain("overlay.result.rendered");
  });

  it("clears stale overlay content on scan start and dismiss", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    api.emitScanResult(scanResult());
    await flushPromises();
    expect(document.getElementById("overlayResults")!.children).toHaveLength(1);

    api.emitScanProgress({ stage: "capturing", message: "Preparing scan..." });
    expect(document.getElementById("overlayResults")!.children).toHaveLength(0);
    expect(document.getElementById("overlayDetected")!.textContent).toBe("0");
    expect(document.getElementById("overlayStatus")!.textContent).toBe("Preparing scan...");

    api.emitScanResult(scanResult());
    await document.getElementById("dismissOverlay")!.trigger("click");
    expect(document.getElementById("overlayResults")!.children).toHaveLength(0);
    expect(document.getElementById("overlayStatus")!.textContent).toBe("No results yet");
  });

  it("renders hover logs into an overlay-level popover", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    api.emitScanResult(scanResult({ boss: "Abyss Lord Kazeros", difficulty: "The First" }));
    await flushPromises();
    await document.getElementById("overlayResults")!.children[0].trigger("pointerenter");

    const popover = document.getElementById("overlayLogPopover")!;
    expect(popover.hidden).toBe(false);
    expect(popover.innerHTML).toContain("Encounter");
    expect(popover.innerHTML).toContain("Percentile");
    expect(popover.innerHTML).toContain("The First");
    expect(popover.innerHTML).toContain("G1");
    expect(popover.innerHTML).toContain("Abyss Lord Kazeros");
    expect(popover.innerHTML).toContain("306.5M");
    expect(document.getElementById("overlayResults")!.children[0].innerHTML).not.toContain("log-detail-row");
  });

  it("renders resolved encounter difficulty in the overlay header", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    api.emitScanResult(scanResult({
      encounter: {
        visibleText: "[Hard] Final Day",
        groupName: "Kazeros",
        difficulty: "Hard",
        bosses: ["Death Incarnate Kazeros"]
      }
    }));
    await flushPromises();

    expect(document.getElementById("overlayEncounter")!.textContent).toBe("[Hard] Final Day");
  });

  it("renders Archdemon Kazeros as Kazeros G2", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    api.emitScanResult(scanResult({ boss: "Archdemon Kazeros", difficulty: "Normal" }));
    await flushPromises();
    await document.getElementById("overlayResults")!.children[0].trigger("pointerenter");

    const popover = document.getElementById("overlayLogPopover")!;
    expect(popover.innerHTML).toContain("G2");
    expect(popover.innerHTML).toContain("Archdemon Kazeros");
  });

  it("renders support popover percentiles with lostark.bible separators", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    api.emitScanResult(scanResult({ role: "support", percentile: 0.95, contributionPercentile: 0.33 }));
    await flushPromises();
    await document.getElementById("overlayResults")!.children[0].trigger("pointerenter");

    const html = document.getElementById("overlayLogPopover")!.innerHTML;
    expect(html).toContain("color:#3dd351");
    expect(html).toContain(">33</b>");
    expect(html).toContain("support-percentile-divider");
    expect(html).toContain("color:#FFA441");
    expect(html).toContain(">95</b>");
    expect(html).toContain("performance-separator");
    expect(html).not.toContain("support-percentile-separator");
    expect(html).not.toContain("percentile-badge");
    expect(document.getElementById("overlayResults")!.children[0].innerHTML).toContain("support-percentile-divider");
  });

  it("renders friendly scrape failure messages without raw flags", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    api.emitScanResult(scanResult({ selectedLog: false, flags: ["no-public-logs", "scrape-failed"] }));
    const row = document.getElementById("overlayResults")!.children[0];

    expect(row.querySelector(".lookup-message")?.textContent).toBe("Could not load logs for Pepegami");
    expect(row.querySelector(".lookup-message")?.className).toContain("load-failed");
    expect(row.innerHTML).not.toContain("no-public-logs");
    expect(row.innerHTML).not.toContain("scrape-failed");
  });

  it("does not render class icons for known class metadata", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    api.emitScanResult(scanResult());
    await flushPromises();
    const row = document.getElementById("overlayResults")!.children[0];

    expect(row.innerHTML).not.toContain("class=\"class-icon\"");
    expect(row.innerHTML).not.toContain("classes/205.png");
    expect(row.querySelector(".meta")?.textContent).toContain("Sorceress");
  });

  it("renders a warning when showing fallback logs for a known encounter", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    api.emitScanResult(scanResult({
      boss: "Corvus Tul Rak",
      difficulty: "Hard",
      flags: ["no-encounter-match"],
      encounter: {
        visibleText: "[Hard] Final Day",
        groupName: "Kazeros",
        difficulty: "Hard",
        bosses: ["Death Incarnate Kazeros", "Archdemon Kazeros", "Abyss Lord Kazeros"]
      }
    }));
    const row = document.getElementById("overlayResults")!.children[0];

    expect(row.querySelector(".encounter-tag")?.textContent).toBe("⚠ Hard | G2 | Corvus Tul Rak");
    expect(row.querySelector(".encounter-tag")?.className).toContain("fallback-log");
    expect(row.querySelector(".lookup-message")?.textContent).toBe("");
  });

  it("wires settings buttons to their expected APIs", async () => {
    const document = new FakeDocument(settingsIds);
    const window = new FakeWindow({ href: "app://index.html?view=settings", search: "?view=settings" });
    const api = createApi();
    window.loaLobbyLogs = api;
    document.getElementById("server")!.value = "NA";
    document.getElementById("scanHotkey")!.value = "Ctrl+Alt+D";

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();
    document.getElementById("overlayPosition")!.value = "right";

    await document.getElementById("saveSettings")!.trigger("click");
    await document.getElementById("scanNow")!.trigger("click");

    expect(api.saveSettingsCalls).toBe(1);
    expect(api.savedSettings?.overlayPosition).toBe("right");
    expect(api.startScanCalls).toBe(1);
    expect(api.savedSettings?.captureMode).toBe("foreground-window-display");
    expect(document.getElementById("settingsMessage")!.textContent).toBe("Saved NA / Ctrl+Alt+D / Overlay right");
    const calibrationStatus = document.getElementById("calibrationStatus")!;
    expect(calibrationStatus.children).toHaveLength(2);
    expect(calibrationStatus.children[0].children[0].textContent).toBe("Encounter Title");
    expect(calibrationStatus.children[0].children[1].textContent).toBe("10, 20, 30 x 40");
    expect(calibrationStatus.children[1].children[0].textContent).toBe("Character List");
    expect(calibrationStatus.children[1].children[1].textContent).toBe("Unset");
    expect(api.events).toContainEqual({ event: "button.click", data: { action: "settings.save" } });
    expect(api.events).toContainEqual({ event: "button.click", data: { action: "settings.scanNow" } });
  });

  it("captures hotkeys in settings and supports cancelling with Escape", async () => {
    const document = new FakeDocument(settingsIds);
    const window = new FakeWindow({ href: "app://index.html?view=settings", search: "?view=settings" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    const hotkey = document.getElementById("scanHotkey")!;
    expect(hotkey.readOnly).toBe(true);

    await hotkey.trigger("focus");
    expect(hotkey.value).toBe("Press hotkey...");
    await hotkey.trigger("keydown", { key: "F8", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
    expect(hotkey.value).toBe("F8");
    expect(api.saveSettingsCalls).toBe(0);

    await hotkey.trigger("focus");
    await hotkey.trigger("keydown", { key: "d", ctrlKey: true, altKey: true, shiftKey: false, metaKey: false });
    expect(hotkey.value).toBe("Ctrl+Alt+D");

    await hotkey.trigger("focus");
    await hotkey.trigger("keydown", { key: "Shift", ctrlKey: false, altKey: false, shiftKey: true, metaKey: false });
    expect(hotkey.value).toBe("Press hotkey...");
    await hotkey.trigger("keydown", { key: "Escape", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
    expect(hotkey.value).toBe("Ctrl+Alt+D");

    await document.getElementById("saveSettings")!.trigger("click");
    expect(api.saveSettingsCalls).toBe(1);
    expect(api.savedSettings?.scanHotkey).toBe("Ctrl+Alt+D");
  });

  it("distinguishes private logs, missing characters, and scrape failures", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    api.emitScanResult(scanResult({ selectedLog: false, flags: ["no-public-logs"] }));
    let row = document.getElementById("overlayResults")!.children[0];
    expect(row.querySelector(".meta")?.textContent).toContain("ilvl 1765.33 | CP 5,216.71");
    expect(row.querySelector(".lookup-message")?.textContent).toBe("Character Pepegami does not have public logs");
    expect(row.querySelector(".lookup-message")?.className).toContain("no-public-logs");

    api.emitScanResult(scanResult({ selectedLog: false, flags: ["character-not-found"] }));
    row = document.getElementById("overlayResults")!.children[0];
    expect(row.querySelector(".lookup-message")?.textContent).toBe("Character Pepegami was not found");
    expect(row.querySelector(".lookup-message")?.className).toContain("character-not-found");

    api.emitScanResult(scanResult({ selectedLog: false, flags: ["no-public-logs", "scrape-failed"] }));
    row = document.getElementById("overlayResults")!.children[0];
    expect(row.querySelector(".lookup-message")?.textContent).toBe("Could not load logs for Pepegami");
    expect(row.querySelector(".lookup-message")?.className).toContain("load-failed");
  });

  it("renders missing calibration as unset coordinates", async () => {
    const document = new FakeDocument(settingsIds);
    const window = new FakeWindow({ href: "app://index.html?view=settings", search: "?view=settings" });
    const api = createApi({
      calibrationStatus: {
        configured: false,
        config: { version: 1 },
        zones: { encounterTitle: false, characterList: false }
      }
    });
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    const calibrationStatus = document.getElementById("calibrationStatus")!;
    expect(calibrationStatus.children[0].children[0].textContent).toBe("Encounter Title");
    expect(calibrationStatus.children[0].children[1].textContent).toBe("Unset");
    expect(calibrationStatus.children[1].children[0].textContent).toBe("Character List");
    expect(calibrationStatus.children[1].children[1].textContent).toBe("Unset");
  });

  it("renders scan progress and opens settings from calibration warning", async () => {
    const document = new FakeDocument(overlayIds);
    const window = new FakeWindow({ href: "app://index.html?view=overlay", search: "?view=overlay" });
    const api = createApi();
    window.loaLobbyLogs = api;

    bootRenderer({ window: window as unknown as Window, document: document as unknown as Document });
    await flushPromises();

    api.emitScanProgress({
      stage: "needs-calibration",
      message: "Calibration is not set."
    });
    await document.getElementById("openSettingsFromOverlay")!.trigger("click");

    expect(document.getElementById("overlayProgress")!.hidden).toBe(false);
    expect(document.getElementById("overlayProgressTitle")!.textContent).toBe("Calibration Required");
    expect(document.getElementById("overlayProgressMessage")!.textContent).toBe("Calibration is not set.");
    expect(document.getElementById("overlayStatus")!.textContent).toBe("Calibration is not set.");
    expect(document.getElementById("openSettingsFromOverlay")!.hidden).toBe(false);
    expect(api.openSettingsCalls).toBe(1);
  });
});

function createApi(options: {
  calibrationStatus?: Awaited<ReturnType<AppApi["getCalibrationStatus"]>>;
} = {}): AppApi & {
  readonly events: Array<{ event: string; data?: Record<string, unknown> }>;
  dismissOverlayCalls: number;
  saveSettingsCalls: number;
  startScanCalls: number;
  reviewLobbyCalls: number;
  openSettingsCalls: number;
  savedSettings?: AppSettings;
  emitScanResult(result: ScanResult): void;
  emitScanProgress(progress: ScanProgress): void;
} {
  const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
  const listeners: Array<(result: ScanResult) => void> = [];
  const progressListeners: Array<(progress: ScanProgress) => void> = [];
  const settings: AppSettings = {
    server: "NA",
    scanHotkey: "Ctrl+Alt+D",
    captureMode: "foreground-window-display",
    overlayPosition: "left"
  };

  const api: AppApi & {
    readonly events: Array<{ event: string; data?: Record<string, unknown> }>;
    dismissOverlayCalls: number;
    saveSettingsCalls: number;
    startScanCalls: number;
    reviewLobbyCalls: number;
    openSettingsCalls: number;
    savedSettings?: AppSettings;
    emitScanResult(result: ScanResult): void;
    emitScanProgress(progress: ScanProgress): void;
  } = {
    events,
    dismissOverlayCalls: 0,
    saveSettingsCalls: 0,
    startScanCalls: 0,
    reviewLobbyCalls: 0,
    openSettingsCalls: 0,
    reviewLobby: async () => {
      api.reviewLobbyCalls += 1;
      return scanResult();
    },
    startScan: async () => {
      api.startScanCalls += 1;
      return scanResult();
    },
    onScanResultUpdated: (callback) => {
      listeners.push(callback);
      return () => undefined;
    },
    onScanProgressUpdated: (callback) => {
      progressListeners.push(callback);
      return () => undefined;
    },
    dismissOverlay: async () => {
      api.dismissOverlayCalls += 1;
    },
    openSettings: async () => {
      api.openSettingsCalls += 1;
    },
    getSettings: async () => settings,
    saveSettings: async (nextSettings) => {
      api.saveSettingsCalls += 1;
      api.savedSettings = nextSettings;
      Object.assign(settings, nextSettings);
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
      encounterTitle: { x: 0, y: 0, width: 1, height: 1 }
    }),
    getCalibrationStatus: async () => ({
      configured: false,
      config: {
        version: 1,
        encounterTitle: { x: 10, y: 20, width: 30, height: 40 }
      },
      zones: { encounterTitle: true, characterList: false }
    } satisfies Awaited<ReturnType<AppApi["getCalibrationStatus"]>>),
    saveCalibration: async (config) => config,
    startCalibration: async () => undefined,
    completeCalibration: async () => undefined,
    setAlwaysOnTop: async () => true,
    emitScanResult: (result) => {
      for (const listener of listeners) listener(result);
    },
    emitScanProgress: (progress) => {
      for (const listener of progressListeners) listener(progress);
    }
  };

  if (options.calibrationStatus) {
    api.getCalibrationStatus = async () => options.calibrationStatus!;
  }

  return api;
}

function scanResult(options: {
  boss?: string;
  difficulty?: string;
  role?: "dps" | "support";
  percentile?: number;
  contributionPercentile?: number;
  selectedLog?: boolean;
  flags?: ScanResult["summaries"][number]["flags"];
  encounter?: ScanResult["encounter"];
} = {}): ScanResult {
  const role = options.role ?? "dps";
  const selectedLog = {
    id: "log-1",
    name: "Pepegami",
    boss: options.boss ?? "Dark Baratron",
    difficulty: options.difficulty ?? "Hard",
    dps: 1_077_347_781,
    ndps: 306_477_091,
    rdps: role === "support" ? 491000 : undefined,
    rContribution: role === "support" ? 0.491 : undefined,
    buffs: role === "support" ? [0.97, 0.99, 0.94, 0.41] : undefined,
    className: "Sorceress",
    spec: role === "support" ? "Full Bloom" : "Igniter",
    gearScore: 1765.329950546875,
    combatPower: 5216.7099609375,
    percentile: options.percentile ?? 0.99,
    contributionPercentile: options.contributionPercentile,
    duration: 480,
    timestamp: Date.now(),
    isBus: false,
    isDead: false
  };

  return {
    encounter: options.encounter ?? { visibleText: "Dark Baratron", groupName: "Dark Baratron", bosses: ["Dark Baratron"] },
    candidates: [{
      rawText: "Pepegami",
      normalizedName: "Pepegami",
      confidence: 0.9,
      sourceMode: "character-list",
      cropRect: { x: 0, y: 0, width: 1, height: 1 }
    }],
    summaries: [{
      name: "Pepegami",
      className: "Sorceress",
      classId: 205,
      classIconUrl: "https://raw.githubusercontent.com/snoww/loa-logs/master/static/images/classes/205.png",
      spec: "Igniter",
      gearScore: 1765.329950546875,
      combatPower: 5216.7099609375,
      selectedLog: options.selectedLog === false ? undefined : selectedLog,
      recentEncounterLogs: options.selectedLog === false ? [] : [selectedLog],
      displayMetrics: {
        role,
        percentileBadges: role === "support"
          ? [
            { value: options.contributionPercentile ?? 0.33, label: "33", textColor: "#3dd351", backgroundColor: "#3dd351" },
            { value: options.percentile ?? 0.95, label: "95", textColor: "#FFA441", backgroundColor: "#ff8000" }
          ]
          : [{ value: 0.99, label: "99", textColor: "#FF69B4", backgroundColor: "#ee59a5" }],
        performance: role === "support"
          ? [{ label: "AP", value: "97" }, { label: "Brand", value: "99" }, { label: "Identity", value: "94" }, { label: "T", value: "41" }]
          : [{ label: "DPS", value: "1.1B" }],
        ndps: role === "support"
          ? { label: "rDPS", marker: "r", value: "49.1%" }
          : { label: "nDPS", marker: "n", value: "306.5M" }
      },
      currentEncounterLogs: [],
      recentOtherLogs: [],
      bestPercentile: 0.99,
      medianPercentile: 0.95,
      bestDps: 1_077_347_781,
      medianDps: 900_000_000,
      medianNdps: 306_477_091,
      latestTimestamp: 1,
      flags: options.flags ?? ["ocr-uncertain", "scrape-failed"]
    }],
    generatedAt: "2026-05-31T04:41:02.660Z",
    warnings: []
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
