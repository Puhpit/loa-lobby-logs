import { describe, expect, it } from "vitest";
import { overlayBounds, overlayProgressHeight, overlayResultHeight } from "../src/main/overlayWindow.js";

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

  it("supports compact progress bounds", () => {
    expect(overlayBounds(workArea, "left", overlayProgressHeight("capturing"))).toEqual({ x: 100, y: 40, width: 720, height: 96 });
    expect(overlayBounds(workArea, "right", overlayProgressHeight("needs-calibration"))).toEqual({ x: 1940, y: 40, width: 720, height: 178 });
  });

  it("sizes result bounds from visible rows and warnings", () => {
    expect(overlayResultHeight(1)).toBe(239);
    expect(overlayResultHeight(8)).toBe(785);
    expect(overlayResultHeight(20)).toBe(1721);
    expect(overlayBounds(workArea, "left", overlayResultHeight(20)).height).toBe(900);
    expect(overlayBounds({ ...workArea, height: 500 }, "left", overlayResultHeight(20)).height).toBe(500);
  });
});
