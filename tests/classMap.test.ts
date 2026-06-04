import { describe, expect, it } from "vitest";
import { classMetadataForLostArkBibleKey } from "../src/main/classMap.js";

describe("classMetadataForLostArkBibleKey", () => {
  it.each([
    ["hawk_eye", "Sharpshooter", 502],
    ["hawkeye", "Sharpshooter", 502],
    ["devil_hunter", "Deadeye", 503],
    ["elemental_master", "Sorceress", 205],
    ["yinyangshi", "Artist", 602],
    ["weather_artist", "Aeromancer", 603],
    ["alchemist", "Wildsoul", 604],
    ["demonic", "Shadowhunter", 403],
    ["reaper", "Reaper", 404]
  ])("maps %s to %s icon %s", (classKey, className, classId) => {
    expect(classMetadataForLostArkBibleKey(classKey)).toEqual({
      className,
      classId,
      classIconUrl: `https://raw.githubusercontent.com/snoww/loa-logs/master/static/images/classes/${classId}.png`
    });
  });

  it("falls back to Unknown for unmapped class keys", () => {
    expect(classMetadataForLostArkBibleKey("future_class")).toEqual({
      className: "Unknown",
      classId: 0,
      classIconUrl: "https://raw.githubusercontent.com/snoww/loa-logs/master/static/images/classes/0.png",
      classMappingWarning: "Unknown lostark.bible class key: future_class"
    });
  });
});
