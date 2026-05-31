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
});
