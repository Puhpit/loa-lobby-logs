import { describe, expect, it } from "vitest";
import {
  ScreenshotCharacterSource,
  analyzeCandidatesFromOcrText,
  candidatesFromOcrText,
  detectCardsFromOcr,
  detectLayoutCards,
  getEncounterTextFromScreenshot
} from "../src/main/ocrCharacterSource.js";
import { dedupeCharacterCandidates, isServerLikeToken, normalizeOcrName, normalizeOcrNames } from "../src/main/nameNormalization.js";
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

  it("suppresses fuzzy OCR variants of server names", () => {
    expect(isServerLikeToken("Ba1thorr")).toBe(true);
    expect(isServerLikeToken("Brelshaz4")).toBe(true);
    expect(isServerLikeToken("Vairgrys")).toBe(true);
    expect(normalizeOcrNames("Ba1thorr Brelshaz4 Pepegami")).toEqual(["Pepegami"]);
  });

  it("keeps rejected OCR diagnostics out of accepted lookup candidates", () => {
    const analysis = analyzeCandidatesFromOcrText("Balthorr\nRecruiting Raid Group\nPepegami", 90, "character-list", rect);

    expect(analysis.accepted.map((candidate) => candidate.normalizedName)).toEqual(["Pepegami"]);
    expect(analysis.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ normalizedName: "Balthorr", textRole: "server", rejectedReason: "server-like" }),
      expect.objectContaining({ normalizedName: "Recruiting", textRole: "ui", rejectedReason: "ui-token" })
    ]));
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

    expect(rectangles[0]).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it("passes page segmentation settings to Tesseract", async () => {
    const options: unknown[] = [];
    const source = new ScreenshotCharacterSource({
      imagePath: "screenshot.png",
      calibration: {
        version: 1,
        encounterTitle: { x: 10, y: 20, width: 30, height: 40 },
        characterList: rect
      },
      tesseract: {
        recognize: async (_imagePath, _language, ocrOptions) => {
          options.push(ocrOptions);
          return { data: { text: "Pepegami", confidence: 90 } };
        }
      }
    });

    await source.getVisibleApplicants();

    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ tessedit_pageseg_mode: "6" }),
      expect.objectContaining({ tessedit_pageseg_mode: "7" }),
      expect.objectContaining({ tessedit_pageseg_mode: "8" })
    ]));
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

  it("uses single-line page segmentation for encounter OCR", async () => {
    const options: unknown[] = [];
    await getEncounterTextFromScreenshot(
      "screenshot.png",
      {
        version: 1,
        encounterTitle: { x: 10, y: 20, width: 30, height: 40 },
        characterList: rect
      },
      {
        recognize: async (_imagePath, _language, ocrOptions) => {
          options.push(ocrOptions);
          return { data: { text: "Kazeros", confidence: 90 } };
        }
      }
    );

    expect(options[0]).toEqual(expect.objectContaining({ tessedit_pageseg_mode: "7" }));
  });
});

describe("detectCardsFromOcr", () => {
  it("generates one-zone layout card crops for roster and applicant patterns", () => {
    const cards = detectLayoutCards({ x: 1000, y: 100, width: 500, height: 470 });

    expect(cards.length).toBeGreaterThanOrEqual(12);
    expect(cards[0].nameRect).toMatchObject({ x: 1030, width: 190 });
    expect(cards.some((card) => card.nameRect.x > 1250)).toBe(true);
  });

  it("detects card name crops from OCR word boxes", () => {
    const cards = detectCardsFromOcr({
      data: {
        text: "Pepegami\nBalthorr\nBadseedrestart",
        confidence: 90,
        words: [
          { text: "Pepegami", confidence: 92, bbox: { x0: 20, y0: 10, x1: 90, y1: 24 } },
          { text: "Balthorr", confidence: 90, bbox: { x0: 22, y0: 44, x1: 82, y1: 58 } },
          { text: "Badseedrestart", confidence: 91, bbox: { x0: 20, y0: 82, x1: 128, y1: 96 } }
        ]
      }
    }, { x: 100, y: 200, width: 300, height: 120 });

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      type: "roster-card",
      nameRect: expect.objectContaining({ x: 112, y: 206 })
    });
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
