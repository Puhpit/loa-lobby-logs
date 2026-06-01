import { describe, expect, it } from "vitest";
import { ScreenshotCharacterSource, candidatesFromOcrText, getEncounterTextFromScreenshot } from "../src/main/ocrCharacterSource.js";
import { dedupeCharacterCandidates, normalizeOcrName, normalizeOcrNames } from "../src/main/nameNormalization.js";
import type { CharacterCandidate, Rect } from "../src/shared/types.js";

const rect: Rect = { x: 1, y: 2, width: 3, height: 4 };

describe("normalizeOcrName", () => {
  it("extracts a Lost Ark style character name from noisy OCR text", () => {
    expect(normalizeOcrName("Lv. 70 Badseedrestart")).toBe("Badseedrestart");
    expect(normalizeOcrName("Brelshaza | Pepegami")).toBe("Pepegami");
  });

  it("rejects empty and punctuation-only text", () => {
    expect(normalizeOcrName("[] ||")).toBe("");
  });

  it("preserves Unicode Latin letters in character names", () => {
    expect(normalizeOcrName("Lv. 70 Astrèa")).toBe("Astrèa");
    expect(normalizeOcrName("Brelshaza | Spártácus")).toBe("Spártácus");
    expect(normalizeOcrName("Ørnblade")).toBe("Ørnblade");
  });
});

describe("dedupeCharacterCandidates", () => {
  it("keeps the highest-confidence candidate for each normalized name", () => {
    const candidates: CharacterCandidate[] = [
      candidate("Badseedrestart", 0.4),
      candidate("badseedrestart", 0.9),
      candidate("Pepegami", 0.8)
    ];

    expect(dedupeCharacterCandidates(candidates).map((value) => `${value.normalizedName}:${value.confidence}`)).toEqual([
      "badseedrestart:0.9",
      "Pepegami:0.8"
    ]);
  });
});

describe("candidatesFromOcrText", () => {
  it("turns OCR lines into normalized applicants", () => {
    const candidates = candidatesFromOcrText("Lv. 70 Badseedrestart\nPepegami", 82, "character-list", rect);

    expect(candidates.map((candidate) => candidate.normalizedName)).toEqual(["Badseedrestart", "Pepegami"]);
    expect(candidates[0].confidence).toBe(0.82);
    expect(candidates[0].cropRect).toEqual(rect);
  });

  it("filters recruitment UI tokens and current server names", () => {
    const candidates = candidatesFromOcrText(
      "Party\nRecruiting Raid Group\nApplicant\nDetails\nLobby\nMember\nSelected\nSettings\nView\nRec\nRecr\nRecrui\nRecruit\nRecruiti\nBalthorr\nLuterra\nLuttera\nNineveh\nInanna\nVairgrys\nThaemine\nBrelshaza\nOrtuus\nElpon\nRatik\nArcturus\nGienah\nPepegami",
      80,
      "character-list",
      rect
    );

    expect(candidates.map((candidate) => candidate.normalizedName)).toEqual(["Pepegami"]);
  });

  it("does not filter difficulty or encounter words from character OCR", () => {
    expect(normalizeOcrNames("First Hard Normal Nightmare Gate Kazeros Serca Armoche Mordum")).toEqual([
      "First",
      "Hard",
      "Normal",
      "Nightmare",
      "Gate",
      "Kazeros",
      "Serca",
      "Armoche",
      "Mordum"
    ]);
  });

});

describe("ScreenshotCharacterSource", () => {
  it("uses only the calibrated character list rectangle", async () => {
    const rectangles: unknown[] = [];
    const source = new ScreenshotCharacterSource({
      imagePath: "screenshot.png",
      calibration: {
        version: 1,
        encounterTitle: { x: 10, y: 20, width: 30, height: 40 },
        characterList: rect
      },
      tesseract: {
        recognize: async (_imagePath, _language, options) => {
          rectangles.push(options?.rectangle);
          return { data: { text: "Pepegami", confidence: 90 } };
        }
      }
    });

    await source.getVisibleApplicants();

    expect(rectangles).toEqual([{ left: 1, top: 2, width: 3, height: 4 }]);
  });
});

describe("getEncounterTextFromScreenshot", () => {
  it("uses only the calibrated encounter title rectangle", async () => {
    const rectangles: unknown[] = [];
    const text = await getEncounterTextFromScreenshot(
      "screenshot.png",
      {
        version: 1,
        encounterTitle: { x: 10, y: 20, width: 30, height: 40 },
        characterList: rect
      },
      {
        recognize: async (_imagePath, _language, options) => {
          rectangles.push(options?.rectangle);
          return { data: { text: "Kazeros", confidence: 90 } };
        }
      }
    );

    expect(text).toBe("Kazeros");
    expect(rectangles).toEqual([{ left: 10, top: 20, width: 30, height: 40 }]);
  });
});

function candidate(normalizedName: string, confidence: number): CharacterCandidate {
  return {
    rawText: normalizedName,
    normalizedName,
    confidence,
    sourceMode: "character-list",
    cropRect: rect
  };
}
