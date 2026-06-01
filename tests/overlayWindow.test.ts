import { describe, expect, it } from "vitest";
import { overlayBounds } from "../src/main/overlayWindow.js";

describe("overlayBounds", () => {
  const workArea = { x: 100, y: 40, width: 2560, height: 900 };

  it("places the overlay on the left edge by default setting", () => {
    expect(overlayBounds(workArea, "left")).toEqual({ x: 100, y: 40, width: 720, height: 760 });
  });

  it("places the overlay on the right edge when configured", () => {
    expect(overlayBounds(workArea, "right")).toEqual({ x: 1940, y: 40, width: 720, height: 760 });
  });

  it("clamps height to the available work area", () => {
    expect(overlayBounds({ ...workArea, height: 600 }, "left").height).toBe(600);
  });
});
