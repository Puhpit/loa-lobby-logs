import type { CharacterCandidate, CharacterSource, OcrSourceMode, Rect } from "../shared/types.js";
import type { CalibrationConfig } from "./calibration.js";
import type { DiagnosticsLogger } from "./diagnostics.js";
import { analyzeOcrNames, dedupeCharacterCandidates } from "./nameNormalization.js";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, parse } from "node:path";
import { tmpdir } from "node:os";

interface TesseractResult {
  data: {
    text: string;
    confidence: number;
    words?: TesseractWord[];
  };
}

interface TesseractWord {
  text?: string;
  confidence?: number;
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
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
    options?: Record<string, unknown> & { rectangle?: TesseractRect; tessedit_char_whitelist?: string; tessedit_pageseg_mode?: string }
  ): Promise<TesseractResult>;
  createWorker?: (language?: string) => Promise<{
    setParameters(params: Record<string, string>): Promise<void>;
    recognize(imagePath: string, options?: { rectangle?: TesseractRect }): Promise<TesseractResult>;
    terminate(): Promise<void>;
  }>;
}

const LOST_ARK_NAME_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝŸŒŠŽ" +
  "àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿœšž ";

export interface ScreenshotCharacterSourceOptions {
  imagePath: string;
  calibration: CalibrationConfig;
  sourceMode?: OcrSourceMode;
  tesseract?: TesseractModule;
  logger?: DiagnosticsLogger;
  scanId?: string;
  debugOutputDir?: string;
}

export interface OcrTextAnalysis {
  accepted: CharacterCandidate[];
  rejected: CharacterCandidate[];
}

export type DetectedCardType = "roster-card" | "lobby-row" | "placeholder" | "unknown";

export interface DetectedCard {
  rect: Rect;
  nameRect: Rect;
  type: DetectedCardType;
  confidence: number;
}

interface RecognizeOptions {
  whitelist?: boolean;
  pageSegMode: string;
}

const NAME_OCR_PSMS = ["7", "8"];
const ZONE_OCR_PSM = "6";
const ENCOUNTER_OCR_PSM = "7";

export class ScreenshotCharacterSource implements CharacterSource {
  private readonly sourceMode: OcrSourceMode;

  constructor(private readonly options: ScreenshotCharacterSourceOptions) {
    this.sourceMode = options.sourceMode ?? "character-list";
  }

  async getVisibleApplicants(): Promise<CharacterCandidate[]> {
    const tesseract = this.options.tesseract ?? (await loadTesseract());
    const cropRect = this.options.calibration.characterList;
    await saveDebugCrop(this.options.imagePath, cropRect, this.options.debugOutputDir, this.options.scanId, "character-zone", this.options.logger);
    const zoneResult = await recognizeText(tesseract, this.options.imagePath, cropRect, { whitelist: true, pageSegMode: ZONE_OCR_PSM });
    const layoutCards = detectLayoutCards(cropRect);
    const cards = mergeCards([...layoutCards, ...detectCardsFromOcr(zoneResult, cropRect)]);
    const cardCandidates: CharacterCandidate[] = [];
    const rejectedCardCandidates: CharacterCandidate[] = [];

    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      await saveDebugCrop(this.options.imagePath, card.nameRect, this.options.debugOutputDir, this.options.scanId, `card-${index + 1}-name`, this.options.logger);
      const analysis = await recognizeNameCrop(tesseract, this.options.imagePath, card.nameRect, this.sourceMode);
      cardCandidates.push(...analysis.accepted);
      rejectedCardCandidates.push(...analysis.rejected);
    }

    const zoneAnalysis = analyzeCandidatesFromOcrText(zoneResult.data.text, zoneResult.data.confidence, this.sourceMode, cropRect);
    const candidates = cardCandidates.length > 0
      ? dedupeCharacterCandidates(cardCandidates)
      : zoneAnalysis.accepted;
    const rejected = [...zoneAnalysis.rejected, ...rejectedCardCandidates];
    this.options.logger?.info("ocr.characters", {
      scanId: this.options.scanId,
      imagePath: this.options.imagePath,
      sourceMode: this.sourceMode,
      cropRect,
      confidence: zoneResult.data.confidence,
      rawText: zoneResult.data.text,
      detectedCards: cards,
      candidates: candidates.map((candidate) => ({
        rawText: candidate.rawText,
        normalizedName: candidate.normalizedName,
        confidence: candidate.confidence,
        textRole: candidate.textRole
      })),
      rejected: rejected.map((candidate) => ({
        rawText: candidate.rawText,
        normalizedName: candidate.normalizedName,
        confidence: candidate.confidence,
        textRole: candidate.textRole,
        rejectedReason: candidate.rejectedReason
      }))
    });
    return candidates;
  }
}

export async function getEncounterTextFromScreenshot(
  imagePath: string,
  calibration: CalibrationConfig,
  tesseract?: TesseractModule,
  logger?: DiagnosticsLogger,
  scanId?: string
): Promise<string> {
  const engine = tesseract ?? (await loadTesseract());
  const cropRect = calibration.encounterTitle;
  const result = await recognizeText(engine, imagePath, cropRect, { whitelist: false, pageSegMode: ENCOUNTER_OCR_PSM });
  const rawText = result.data.text.replace(/\s+/g, " ").trim();
  logger?.info("ocr.encounter", {
    scanId,
    imagePath,
    cropRect,
    confidence: result.data.confidence,
    rawText: result.data.text,
    normalizedText: rawText
  });
  return rawText;
}

export function candidatesFromOcrText(
  text: string,
  confidence: number,
  sourceMode: OcrSourceMode,
  cropRect: Rect
): CharacterCandidate[] {
  return analyzeCandidatesFromOcrText(text, confidence, sourceMode, cropRect).accepted;
}

export function analyzeCandidatesFromOcrText(
  text: string,
  confidence: number,
  sourceMode: OcrSourceMode,
  cropRect: Rect
): OcrTextAnalysis {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const accepted: CharacterCandidate[] = [];
  const rejected: CharacterCandidate[] = [];
  const normalizedConfidence = Math.max(0, Math.min(1, confidence / 100));

  for (const line of lines) {
    const analysis = analyzeOcrNames(line);
    for (const token of analysis) {
      const candidate: CharacterCandidate = {
        rawText: line,
        normalizedName: token.normalizedName,
        confidence: normalizedConfidence,
        sourceMode,
        cropRect,
        textRole: token.textRole,
        rejectedReason: token.rejectedReason
      };

      if (token.rejectedReason) {
        rejected.push(candidate);
      } else {
        accepted.push(candidate);
      }
    }
  }

  return {
    accepted: dedupeCharacterCandidates(accepted),
    rejected
  };
}

async function recognizeNameCrop(
  tesseract: TesseractModule,
  imagePath: string,
  cropRect: Rect,
  sourceMode: OcrSourceMode
): Promise<OcrTextAnalysis> {
  const prepared = await prepareNameCropForOcr(imagePath, cropRect);
  const recognitionImage = prepared
    ? { imagePath: prepared.imagePath, cropRect: { x: 0, y: 0, width: prepared.width, height: prepared.height } }
    : { imagePath, cropRect };
  const passes = await Promise.all(NAME_OCR_PSMS.map(async (pageSegMode) => {
    const result = await recognizeText(tesseract, recognitionImage.imagePath, recognitionImage.cropRect, { whitelist: true, pageSegMode });
    return analyzeCandidatesFromOcrText(result.data.text, result.data.confidence, sourceMode, cropRect);
  }));

  return {
    accepted: dedupeCharacterCandidates(passes.flatMap((pass) => pass.accepted)),
    rejected: passes.flatMap((pass) => pass.rejected)
  };
}

async function prepareNameCropForOcr(imagePath: string, cropRect: Rect): Promise<{ imagePath: string; width: number; height: number } | undefined> {
  try {
    const { nativeImage } = await import("electron");
    const image = nativeImage.createFromPath(imagePath);
    if (image.isEmpty()) return undefined;

    const cropped = image.crop(toElectronRect(cropRect));
    const width = Math.max(1, Math.round(cropRect.width * 3));
    const height = Math.max(1, Math.round(cropRect.height * 3));
    const resized = cropped.resize({ width, height, quality: "best" });
    const outputDir = join(tmpdir(), "loa-lobby-logs", "ocr-prepared");
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
    await writeFile(outputPath, resized.toPNG());
    return { imagePath: outputPath, width, height };
  } catch {
    return undefined;
  }
}

export function detectCardsFromOcr(result: TesseractResult, zoneRect: Rect): DetectedCard[] {
  const wordCards = cardsFromWords(result.data.words ?? [], zoneRect);
  if (wordCards.length > 0) return wordCards;
  return cardsFromTextLines(result.data.text, zoneRect);
}

export function detectLayoutCards(zoneRect: Rect): DetectedCard[] {
  const cards: DetectedCard[] = [];
  const add = (x: number, y: number, width: number, height: number, type: DetectedCardType) => {
    const nameRect = rectFromRelative(zoneRect, x, y, width, height);
    cards.push({
      rect: expandRect(nameRect, zoneRect, Math.round(zoneRect.width * 0.08), Math.round(zoneRect.height * 0.02)),
      nameRect,
      type,
      confidence: 0.65
    });
  };

  for (const y of [0.07, 0.17, 0.27, 0.37]) {
    add(0.06, y - 0.012, 0.38, 0.07, "roster-card");
    add(0.52, y - 0.012, 0.4, 0.07, "roster-card");
  }

  for (const y of [0.145, 0.202, 0.258, 0.315]) {
    add(0.06, y - 0.012, 0.38, 0.07, "roster-card");
    add(0.52, y - 0.012, 0.4, 0.07, "roster-card");
  }

  for (const y of [0.095, 0.24, 0.385, 0.53]) {
    add(0.06, y - 0.012, 0.42, 0.08, "roster-card");
  }

  return mergeCards(cards);
}

async function recognizeText(
  tesseract: TesseractModule,
  imagePath: string,
  cropRect: Rect,
  options: RecognizeOptions
): Promise<TesseractResult> {
  const rectangle = toTesseractRect(cropRect);
  if (tesseract.createWorker) {
    const worker = await tesseract.createWorker("eng");
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: options.pageSegMode
      });
      if (options.whitelist !== false) {
        await worker.setParameters({
          tessedit_char_whitelist: LOST_ARK_NAME_CHARS,
          load_system_dawg: "false",
          load_freq_dawg: "false"
        });
      }
      return await worker.recognize(imagePath, { rectangle });
    } finally {
      await worker.terminate();
    }
  }

  return tesseract.recognize(imagePath, "eng", {
    rectangle,
    tessedit_pageseg_mode: options.pageSegMode,
    ...(options.whitelist !== false ? {
      tessedit_char_whitelist: LOST_ARK_NAME_CHARS,
      load_system_dawg: "false",
      load_freq_dawg: "false"
    } : {})
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

function cardsFromWords(words: TesseractWord[], zoneRect: Rect): DetectedCard[] {
  const nameWords = words
    .map((word) => ({
      text: word.text?.trim() ?? "",
      confidence: Math.max(0, Math.min(1, (word.confidence ?? 0) / 100)),
      rect: word.bbox ? {
        x: zoneRect.x + word.bbox.x0,
        y: zoneRect.y + word.bbox.y0,
        width: Math.max(1, word.bbox.x1 - word.bbox.x0),
        height: Math.max(1, word.bbox.y1 - word.bbox.y0)
      } : undefined
    }))
    .filter((word) => word.rect && analyzeOcrNames(word.text).some((token) => !token.rejectedReason));

  const rows = new Map<number, typeof nameWords>();
  const rowHeight = Math.max(16, Math.round(zoneRect.height / 20));
  for (const word of nameWords) {
    const key = Math.round((word.rect!.y - zoneRect.y) / rowHeight);
    rows.set(key, [...(rows.get(key) ?? []), word]);
  }

  return [...rows.values()].map((row) => {
    const rects = row.map((word) => word.rect!);
    const nameRect = expandRect(unionRects(rects), zoneRect, 8, 4);
    return {
      rect: expandRect(nameRect, zoneRect, 48, 8),
      nameRect,
      type: "roster-card" as const,
      confidence: Math.max(...row.map((word) => word.confidence))
    };
  });
}

function cardsFromTextLines(text: string, zoneRect: Rect): DetectedCard[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const rowHeight = Math.max(1, Math.floor(zoneRect.height / Math.max(lines.length, 1)));

  return lines.flatMap((line, index) => {
    const analysis = analyzeOcrNames(line);
    if (!analysis.some((token) => !token.rejectedReason)) return [];
    const y = zoneRect.y + Math.min(zoneRect.height - rowHeight, index * rowHeight);
    const rect = { x: zoneRect.x, y, width: zoneRect.width, height: rowHeight };
    return [{
      rect,
      nameRect: probableNameRect(rect),
      type: classifyCardLine(line),
      confidence: 0.5
    }];
  });
}

function classifyCardLine(text: string): DetectedCardType {
  const lower = text.toLocaleLowerCase();
  if (lower.includes("recruiting raid group")) return "placeholder";
  if (lower.includes("gate") || lower.includes("clear") || lower.includes("reclear")) return "lobby-row";
  return "roster-card";
}

function probableNameRect(cardRect: Rect): Rect {
  const leftInset = Math.round(cardRect.width * 0.16);
  const rightInset = Math.round(cardRect.width * 0.08);
  return {
    x: cardRect.x + leftInset,
    y: cardRect.y,
    width: Math.max(1, cardRect.width - leftInset - rightInset),
    height: cardRect.height
  };
}

function rectFromRelative(bounds: Rect, x: number, y: number, width: number, height: number): Rect {
  return {
    x: bounds.x + Math.round(bounds.width * x),
    y: bounds.y + Math.round(bounds.height * y),
    width: Math.max(1, Math.round(bounds.width * width)),
    height: Math.max(1, Math.round(bounds.height * height))
  };
}

function mergeCards(cards: DetectedCard[]): DetectedCard[] {
  const result: DetectedCard[] = [];

  for (const card of cards.sort((left, right) => left.nameRect.y - right.nameRect.y || left.nameRect.x - right.nameRect.x)) {
    if (result.some((existing) => rectOverlapRatio(existing.nameRect, card.nameRect) > 0.65)) continue;
    result.push(card);
  }

  return result;
}

function rectOverlapRatio(left: Rect, right: Rect): number {
  const overlapLeft = Math.max(left.x, right.x);
  const overlapTop = Math.max(left.y, right.y);
  const overlapRight = Math.min(left.x + left.width, right.x + right.width);
  const overlapBottom = Math.min(left.y + left.height, right.y + right.height);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft);
  const overlapHeight = Math.max(0, overlapBottom - overlapTop);
  const overlapArea = overlapWidth * overlapHeight;
  const minArea = Math.min(left.width * left.height, right.width * right.height);
  return minArea === 0 ? 0 : overlapArea / minArea;
}

function unionRects(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function expandRect(rect: Rect, bounds: Rect, xPadding: number, yPadding: number): Rect {
  const x = Math.max(bounds.x, rect.x - xPadding);
  const y = Math.max(bounds.y, rect.y - yPadding);
  const right = Math.min(bounds.x + bounds.width, rect.x + rect.width + xPadding);
  const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height + yPadding);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

async function saveDebugCrop(
  imagePath: string,
  rect: Rect,
  outputDir: string | undefined,
  scanId: string | undefined,
  label: string,
  logger: DiagnosticsLogger | undefined
): Promise<void> {
  if (!outputDir) return;

  try {
    const { nativeImage } = await import("electron");
    const image = nativeImage.createFromPath(imagePath);
    if (image.isEmpty()) return;
    await mkdir(outputDir, { recursive: true });
    const imageName = parse(basename(imagePath)).name;
    const fileName = `${scanId ?? "manual"}-${imageName}-${label}.png`.replace(/[^\w.-]+/g, "_");
    const cropped = image.crop(toElectronRect(rect));
    await writeFile(join(outputDir, fileName), cropped.toPNG());
  } catch (error) {
    logger?.warn("ocr.debugCrop.failed", { imagePath, rect, outputDir, label, error: String(error) });
  }
}

function toElectronRect(rect: Rect): Electron.Rectangle {
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
}
