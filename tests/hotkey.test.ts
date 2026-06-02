import { describe, expect, it } from "vitest";
import { normalizeHotkey } from "../src/main/hotkey.js";

describe("normalizeHotkey", () => {
  it("defaults to a user-facing Ctrl label and Electron Control accelerator", () => {
    expect(normalizeHotkey(undefined)).toEqual({
      userFacing: "Ctrl+Alt+D",
      accelerator: "Control+Alt+D"
    });
  });

  it("normalizes Ctrl aliases and uppercases the key", () => {
    expect(normalizeHotkey(" control + alt + d ")).toEqual({
      userFacing: "Ctrl+Alt+D",
      accelerator: "Control+Alt+D"
    });
  });

  it("accepts bare keys", () => {
    expect(normalizeHotkey("f8")).toEqual({
      userFacing: "F8",
      accelerator: "F8"
    });
  });

  it("normalizes captured special key names", () => {
    expect(normalizeHotkey("Ctrl+ArrowUp")).toEqual({
      userFacing: "Ctrl+Up",
      accelerator: "Control+Up"
    });
    expect(normalizeHotkey("Alt+Space")).toEqual({
      userFacing: "Alt+Space",
      accelerator: "Alt+Space"
    });
    expect(normalizeHotkey("Ctrl+Plus")).toEqual({
      userFacing: "Ctrl+Plus",
      accelerator: "Control+Plus"
    });
  });
});
