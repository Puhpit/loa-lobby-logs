import type { CharacterCandidate, CharacterSource, OcrSourceMode, Rect } from "../shared/types.js";
import { cropRectForMode, type CalibrationConfig } from "./calibration.js";
import type { DiagnosticsLogger } from "./diagnostics.js";
import { dedupeCharacterCandidates, normalizeOcrNames } from "./nameNormalization.js";

interface TesseractResult {
  data: {
    text: string;
    confidence: number;
  };
}

interface TesseractRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TesseractModule {
  recognize(
    imagePath: string,
    language?: string,
    options?: { rectangle?: TesseractRect; tessedit_char_whitelist?: string }
  ): Promise<TesseractResult>;
  createWorker?: (language?: string) => Promise<{
    setParameters(params: Record<string, string>): Promise<void>;
    recognize(imagePath: string, options?: { rectangle?: TesseractRect }): Promise<TesseractResult>;
    terminate(): Promise<void>;
  }>;
}

export interface ScreenshotCharacterSourceOptions {
  imagePath: string;
  calibration: CalibrationConfig;
  sourceMode?: OcrSourceMode;
  tesseract?: TesseractModule;
  logger?: DiagnosticsLogger;
  scanId?: string;
}

export class ScreenshotCharacterSource implements CharacterSource {
  private readonly sourceMode: OcrSourceMode;

  constructor(private readonly options: ScreenshotCharacterSourceOptions) {
    this.sourceMode = options.sourceMode ?? "applicant-list";
  }

  async getVisibleApplicants(): Promise<CharacterCandidate[]> {
    const tesseract = this.options.tesseract ?? (await loadTesseract());
    const cropRect = cropRectForMode(this.options.calibration, this.sourceMode);
    const result = await recognizeText(tesseract, this.options.imagePath, cropRect);

    const candidates = candidatesFromOcrText(result.data.text, result.data.confidence, this.sourceMode, cropRect);
    this.options.logger?.info("ocr.characters", {
      scanId: this.options.scanId,
      imagePath: this.options.imagePath,
      sourceMode: this.sourceMode,
      cropRect,
      confidence: result.data.confidence,
      rawText: result.data.text,
      candidates: candidates.map((candidate) => ({
        rawText: candidate.rawText,
        normalizedName: candidate.normalizedName,
        confidence: candidate.confidence
      }))
    });
    return candidates;
  }
}

export async function getEncounterTextFromScreenshot(
  imagePath: string,
  calibration: CalibrationConfig,
  tesseract?: TesseractModule
): Promise<string> {
  const engine = tesseract ?? (await loadTesseract());
  const result = await recognizeText(engine, imagePath, calibration.encounterTitle, false);

  return result.data.text.replace(/\s+/g, " ").trim();
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
    lines.flatMap((line) => normalizeOcrNames(line).map((normalizedName) => ({
      rawText: line,
      normalizedName,
      confidence: Math.max(0, Math.min(1, confidence / 100)),
      sourceMode,
      cropRect
    })))
  );
}

async function recognizeText(
  tesseract: TesseractModule,
  imagePath: string,
  cropRect: Rect,
  whitelist = true
): Promise<TesseractResult> {
  const rectangle = toTesseractRect(cropRect);
  if (tesseract.createWorker) {
    const worker = await tesseract.createWorker("eng");
    try {
      if (whitelist) {
        await worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 "
        });
      }
      return await worker.recognize(imagePath, { rectangle });
    } finally {
      await worker.terminate();
    }
  }

  return tesseract.recognize(imagePath, "eng", {
    rectangle,
    ...(whitelist ? { tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 " } : {})
  });
}

function toTesseractRect(rect: Rect): TesseractRect {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height
  };
}

async function loadTesseract(): Promise<TesseractModule> {
  try {
    const module = await import("tesseract.js") as TesseractModule & { default?: TesseractModule };
    return typeof module.recognize === "function" ? module : module.default as TesseractModule;
  } catch (error) {
    throw new Error(`OCR engine is unavailable. Install dependencies before using screenshot OCR. ${String(error)}`);
  }
}
