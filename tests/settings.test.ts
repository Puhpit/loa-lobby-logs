import { describe, expect, it } from "vitest";
import { defaultSettings, validateSettings } from "../src/main/settings.js";

describe("validateSettings", () => {
  it("defaults to the MVP settings", () => {
    expect(validateSettings({})).toEqual(defaultSettings);
  });

  it("accepts CE and trims the hotkey", () => {
    expect(validateSettings({ server: "CE", scanHotkey: " Control+Shift+D " })).toEqual({
      ...defaultSettings,
      server: "CE",
      scanHotkey: "Ctrl+Shift+D"
    });
  });

  it("maps legacy regions back to NA", () => {
    expect(validateSettings({ server: "NAW" }).server).toBe("NA");
    expect(validateSettings({ server: "NAE" }).server).toBe("NA");
  });
});
