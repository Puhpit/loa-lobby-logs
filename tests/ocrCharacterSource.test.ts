import { describe, expect, it } from "vitest";
import { candidatesFromOcrText } from "../src/main/ocrCharacterSource.js";
import { dedupeCharacterCandidates, normalizeOcrName } from "../src/main/nameNormalization.js";
import type { CharacterCandidate, Rect } from "../src/shared/types.js";

const rect: Rect = { x: 1, y: 2, width: 3, height: 4 };

describe("normalizeOcrName", () => {
  it("extracts a Lost Ark style character name from noisy OCR text", () => {
    expect(normalizeOcrName("Lv. 70 Badseedrestart")).toBe("Badseedrestart");
    expect(normalizeOcrName("Brelshaza | Pepegami")).toBe("Pepegami");
    expect(normalizeOcrName("Wr  Pepegami O Recr")).toBe("Pepegami");
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
    const candidates = candidatesFromOcrText("Lv. 70 Badseedrestart\nBrelshaza Pepegami", 82, "applicant-list", rect);

    expect(candidates.map((candidate) => candidate.normalizedName)).toEqual(["Badseedrestart", "Pepegami"]);
    expect(candidates[0].confidence).toBe(0.82);
    expect(candidates[0].cropRect).toEqual(rect);
  });

  it("keeps character names from party rows and rejects recruiting text", () => {
    const candidates = candidatesFromOcrText(
      "Party 1 Party 2\nWr  Pepegami O Recr\nRecruiting O Recr\nami\nPepeg",
      43,
      "other-party-selected-lobby",
      rect
    );

    expect(candidates.map((candidate) => candidate.normalizedName)).toEqual(["Pepegami"]);
  });

  it("rejects server, difficulty, and encounter UI labels", () => {
    const candidates = candidatesFromOcrText(
      "The First\nBalthorr\nThaemine\nVairgrys\nLuterra\nKazeros\nPepegami",
      80,
      "applicant-list",
      rect
    );

    expect(candidates.map((candidate) => candidate.normalizedName)).toEqual(["Pepegami"]);
  });
});

function candidate(normalizedName: string, confidence: number): CharacterCandidate {
  return {
    rawText: normalizedName,
    normalizedName,
    confidence,
    sourceMode: "applicant-list",
    cropRect: rect
  };
}
