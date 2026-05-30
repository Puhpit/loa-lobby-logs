import type { CharacterCandidate, CharacterSource, OcrSourceMode, Rect } from "../shared/types.js";
import { cropRectForMode, type CalibrationConfig } from "./calibration.js";
import { dedupeCharacterCandidates, normalizeOcrName } from "./nameNormalization.js";

interface TesseractResult {
  data: {
    text: string;
    confidence: number;
  };
}

interface TesseractModule {
  recognize(
    imagePath: string,
    language?: string,
    options?: { rectangle?: Rect; tessedit_char_whitelist?: string }
  ): Promise<TesseractResult>;
}

export interface ScreenshotCharacterSourceOptions {
  imagePath: string;
  calibration: CalibrationConfig;
  sourceMode?: OcrSourceMode;
  tesseract?: TesseractModule;
}

export class ScreenshotCharacterSource implements CharacterSource {
  private readonly sourceMode: OcrSourceMode;

  constructor(private readonly options: ScreenshotCharacterSourceOptions) {
    this.sourceMode = options.sourceMode ?? "applicant-list";
  }

  async getVisibleApplicants(): Promise<CharacterCandidate[]> {
    const tesseract = this.options.tesseract ?? (await loadTesseract());
    const cropRect = cropRectForMode(this.options.calibration, this.sourceMode);
    const result = await tesseract.recognize(this.options.imagePath, "eng", {
      rectangle: cropRect,
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 "
    });

    return candidatesFromOcrText(result.data.text, result.data.confidence, this.sourceMode, cropRect);
  }
}

export function candidatesFromOcrText(
  text: string,
  confidence: number,
  sourceMode: OcrSourceMode,
  cropRect: Rect
): CharacterCandidate[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return dedupeCharacterCandidates(
    lines.map((line) => ({
      rawText: line,
      normalizedName: normalizeOcrName(line),
      confidence: Math.max(0, Math.min(1, confidence / 100)),
      sourceMode,
      cropRect
    }))
  );
}

async function loadTesseract(): Promise<TesseractModule> {
  try {
    return (await import("tesseract.js")) as TesseractModule;
  } catch (error) {
    throw new Error(`OCR engine is unavailable. Install dependencies before using screenshot OCR. ${String(error)}`);
  }
}
