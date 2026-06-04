import type { CharacterCandidate, CharacterSource, OcrSourceMode, Rect } from "../shared/types.js";
import type { CalibrationConfig } from "./calibration.js";
import type { DiagnosticsLogger } from "./diagnostics.js";
import { analyzeOcrNames, dedupeCharacterCandidates } from "./nameNormalization.js";
import { mkdir } from "node:fs/promises";
import { basename, join, parse } from "node:path";
import { tmpdir } from "node:os";
import sharp, { type Region as SharpRegion } from "sharp";

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
export type OcrLayoutType = "applicant-detail" | "member-grid" | "lobby-overview" | "unknown";

export interface DetectedCard {
  rect: Rect;
  cardRect?: Rect;
  iconRect?: Rect;
  nameRect: Rect;
  serverRect?: Rect;
  statusRect?: Rect;
  type: DetectedCardType;
  layoutType?: OcrLayoutType;
  confidence: number;
  ocrText?: string;
  ocrConfidence?: number;
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
    const visualCards = await detectVisualCardsFromImage(this.options.imagePath, cropRect).catch((error) => {
      this.options.logger?.warn("ocr.visualCards.failed", { scanId: this.options.scanId, imagePath: this.options.imagePath, cropRect, error: String(error) });
      return [];
    });
    let zoneResult = visualCards.length === 0
      ? await recognizeText(tesseract, this.options.imagePath, cropRect, { whitelist: true, pageSegMode: ZONE_OCR_PSM })
      : undefined;
    const cards = visualCards.length > 0 ? visualCards : detectCardsFromOcr(zoneResult!, cropRect);
    const cardCandidates: CharacterCandidate[] = [];
    const rejectedCardCandidates: CharacterCandidate[] = [];

    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      await saveDebugCrop(this.options.imagePath, card.rect, this.options.debugOutputDir, this.options.scanId, `card-${index + 1}`, this.options.logger);
      if (card.iconRect) await saveDebugCrop(this.options.imagePath, card.iconRect, this.options.debugOutputDir, this.options.scanId, `card-${index + 1}-icon`, this.options.logger);
      if (card.serverRect) await saveDebugCrop(this.options.imagePath, card.serverRect, this.options.debugOutputDir, this.options.scanId, `card-${index + 1}-server`, this.options.logger);
      if (card.statusRect) await saveDebugCrop(this.options.imagePath, card.statusRect, this.options.debugOutputDir, this.options.scanId, `card-${index + 1}-status`, this.options.logger);
      await saveDebugCrop(this.options.imagePath, card.nameRect, this.options.debugOutputDir, this.options.scanId, `card-${index + 1}-name`, this.options.logger);
      const analysis = await recognizeNameCrop(tesseract, this.options.imagePath, card.nameRect, this.sourceMode);
      card.ocrText = [...analysis.accepted, ...analysis.rejected].map((candidate) => candidate.rawText).filter(Boolean).join(" | ");
      card.ocrConfidence = Math.max(0, ...analysis.accepted.map((candidate) => candidate.confidence));
      cardCandidates.push(...analysis.accepted);
      rejectedCardCandidates.push(...analysis.rejected);
    }

    const shouldRunZoneFallback = cardCandidates.length !== 1 || cardCandidates[0].confidence < 0.4;
    if (!zoneResult && shouldRunZoneFallback) {
      zoneResult = await recognizeText(tesseract, this.options.imagePath, cropRect, { whitelist: true, pageSegMode: ZONE_OCR_PSM });
    }
    const zoneAnalysis = zoneResult
      ? analyzeCandidatesFromOcrText(zoneResult.data.text, zoneResult.data.confidence, this.sourceMode, cropRect)
      : { accepted: [], rejected: [] };
    const visualCandidates = dedupeCharacterCandidates(cardCandidates);
    const shouldUseZoneFallback = visualCandidates.length === 0 ||
      (visualCandidates.length === 1 && visualCandidates[0].confidence < 0.4 && zoneAnalysis.accepted.length > visualCandidates.length) ||
      (visualCandidates.length >= 2 && zoneAnalysis.accepted.length >= visualCandidates.length + 3);
    const candidates = shouldUseZoneFallback ? zoneAnalysis.accepted : visualCandidates;
    const rejected = [...zoneAnalysis.rejected, ...rejectedCardCandidates];
    this.options.logger?.info("ocr.characters", {
      scanId: this.options.scanId,
      imagePath: this.options.imagePath,
      sourceMode: this.sourceMode,
      cropRect,
      confidence: zoneResult?.data.confidence ?? 0,
      rawText: zoneResult?.data.text ?? "",
      detector: visualCards.length > 0 ? "visual" : "ocr-fallback",
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
    const width = Math.max(1, Math.round(cropRect.width * 3));
    const height = Math.max(1, Math.round(cropRect.height * 3));
    const outputDir = join(tmpdir(), "loa-lobby-logs", "ocr-prepared");
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
    await sharp(imagePath)
      .extract(toSharpRect(cropRect))
      .resize({ width, height, kernel: "lanczos3" })
      .grayscale()
      .normalize()
      .modulate({ brightness: 1.14 })
      .png()
      .toFile(outputPath);
    return { imagePath: outputPath, width, height };
  } catch {
    return undefined;
  }
}

export async function detectVisualCardsFromImage(imagePath: string, zoneRect: Rect): Promise<DetectedCard[]> {
  const zone = toSharpRect(zoneRect);
  const { data, info } = await sharp(imagePath)
    .extract(zone)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return detectVisualCardsFromPixels(data, info.width, info.height, zoneRect);
}

export async function detectVisualLayoutFromImage(imagePath: string, zoneRect: Rect): Promise<OcrLayoutType> {
  const zone = toSharpRect(zoneRect);
  const { data, info } = await sharp(imagePath)
    .extract(zone)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return detectVisualLayoutFromPixels(data, info.width, info.height);
}

export function detectVisualCardsFromPixels(data: Buffer | Uint8Array, width: number, height: number, zoneRect: Rect): DetectedCard[] {
  const layoutType = detectVisualLayoutFromPixels(data, width, height);
  if (layoutType === "member-grid") {
    const gridCards = detectMemberGridCardsFromPixels(data, width, height, zoneRect);
    if (gridCards.length >= 2) return gridCards;
  }
  if (layoutType === "lobby-overview") {
    const overviewCards = detectLobbyOverviewCardsFromPixels(data, width, height, zoneRect);
    if (overviewCards.length >= 4) return overviewCards;
  }

  const rowCounts = new Array<number>(height).fill(0);
  const edgeCounts = new Array<number>(height).fill(0);
  const brightThreshold = 104;
  const edgeThreshold = 20;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (brightness >= brightThreshold) rowCounts[y] += 1;
      if (x > 0) {
        const previousOffset = (y * width + x - 1) * 3;
        const previousBrightness = (data[previousOffset] + data[previousOffset + 1] + data[previousOffset + 2]) / 3;
        if (Math.abs(brightness - previousBrightness) >= edgeThreshold) edgeCounts[y] += 1;
      }
    }
  }

  const rowSignals = rowCounts.map((count, index) => count + Math.round(edgeCounts[index] * 0.55));
  const rowThreshold = Math.max(18, Math.round(width * 0.035));
  const rowBands = mergeNearbySegments(findSegments(rowSignals, rowThreshold, 4), 14)
    .map((segment) => expandSegment(segment, height, 5))
    .filter((segment) => (
      segment.start <= Math.round(height * 0.76) &&
      segment.end - segment.start >= 8 &&
      segment.end - segment.start <= Math.max(74, Math.round(height * 0.16))
    ));
  const cards: DetectedCard[] = [];

  for (const band of rowBands) {
    const bandColSignals = new Array<number>(width).fill(0);
    for (let y = band.start; y <= band.end; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        if (brightness >= 90) bandColSignals[x] += 1;
        if (y > band.start) {
          const previousOffset = ((y - 1) * width + x) * 3;
          const previousBrightness = (data[previousOffset] + data[previousOffset + 1] + data[previousOffset + 2]) / 3;
          if (Math.abs(brightness - previousBrightness) >= 18) bandColSignals[x] += 1;
        }
      }
    }

    const colThreshold = Math.max(3, Math.round((band.end - band.start + 1) * 0.07));
    const colSegments = mergeNearbySegments(findSegments(bandColSignals, colThreshold, 3), 24)
      .map((segment) => expandSegment(segment, width, 4))
      .filter((segment) => {
        const segmentWidth = segment.end - segment.start + 1;
        return segmentWidth >= Math.round(width * 0.08) && segmentWidth <= Math.round(width * 0.48);
      });

    for (const col of colSegments) {
      const card = cardFromVisualCluster(data, width, height, zoneRect, band, col);
      if (card) cards.push(card);
    }
  }

  return mergeCards(cards).filter((card) => card.nameRect.width >= 24 && card.nameRect.height >= 7);
}

export function detectVisualLayoutFromPixels(data: Buffer | Uint8Array, width: number, height: number): OcrLayoutType {
  const laneRows = partyLaneRowCounts(data, width, height);
  if (laneRows.every((rows) => rows >= 3)) return "member-grid";
  const overviewLikeWhiteDensity = countWhiteNamePixels(data, width, height) >= Math.round(width * height * 0.018);
  const overviewRows = overviewLaneRowCounts(data, width, height);
  if (
    overviewLikeWhiteDensity &&
    (
      laneRows.some((rows) => rows >= 3) ||
      laneRows.reduce((sum, rows) => sum + rows, 0) >= 3 ||
      overviewRows.some((rows) => rows >= 3) ||
      overviewRows.reduce((sum, rows) => sum + rows, 0) >= 3
    )
  ) {
    return "lobby-overview";
  }

  const topWideActivity = countBrightPixels(data, width, Math.round(width * 0.04), 0, Math.round(width * 0.82), Math.round(height * 0.2));
  if (topWideActivity >= Math.round(width * height * 0.002)) return "applicant-detail";
  return "unknown";
}

function detectMemberGridCardsFromPixels(data: Buffer | Uint8Array, width: number, height: number, zoneRect: Rect): DetectedCard[] {
  const laneWidth = Math.round(width * 0.42);
  const laneGap = Math.round(width * 0.08);
  const lanes = [
    { start: 0, end: Math.min(width - 1, laneWidth) },
    { start: Math.min(width - 1, laneWidth + laneGap), end: width - 1 }
  ];
  const cards: DetectedCard[] = [];

  for (const lane of lanes) {
    const rowSignals = new Array<number>(height).fill(0);
    const scanLeft = lane.start;
    const scanRight = Math.min(lane.end, lane.start + laneWidth);
    for (let y = 0; y < height; y += 1) {
      for (let x = scanLeft; x <= scanRight; x += 1) {
        const offset = (y * width + x) * 3;
        const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        if (brightness >= 86) rowSignals[y] += 1;
      }
    }

    const rowThreshold = Math.max(4, Math.round((scanRight - scanLeft + 1) * 0.025));
    const rows = mergeNearbySegments(findSegments(rowSignals, rowThreshold, 3), 6)
      .map((segment) => expandSegment(segment, height, 4))
      .filter((segment) => (
        segment.start >= Math.round(height * 0.08) &&
        segment.start <= Math.round(height * 0.56) &&
        segment.end - segment.start >= 8 &&
        segment.end - segment.start <= Math.round(height * 0.095)
      ));

    for (const row of rows) {
      const card = memberGridCard(zoneRect, width, height, lane.start, laneWidth, row);
      if (card) cards.push(card);
    }
  }

  return mergeCards(cards);
}

function detectLobbyOverviewCardsFromPixels(data: Buffer | Uint8Array, width: number, height: number, zoneRect: Rect): DetectedCard[] {
  const laneGap = Math.round(width * 0.08);
  const laneWidth = Math.round((width - laneGap) / 2);
  const lanes = [
    { start: 0, end: Math.max(0, laneWidth - 1) },
    { start: Math.min(width - 1, laneWidth + laneGap), end: width - 1 }
  ];
  const cards: DetectedCard[] = [];

  for (const lane of lanes) {
    const rowSignals = new Array<number>(height).fill(0);
    for (let y = Math.round(height * 0.06); y <= Math.round(height * 0.78); y += 1) {
      for (let x = lane.start; x <= lane.end; x += 1) {
        const offset = (y * width + x) * 3;
        if (isWhiteNamePixel(data[offset], data[offset + 1], data[offset + 2])) rowSignals[y] += 1;
      }
    }

    const rowThreshold = Math.max(4, Math.round((lane.end - lane.start + 1) * 0.018));
    const rows = mergeNearbySegments(findSegments(rowSignals, rowThreshold, 3), 10)
      .map((segment) => expandSegment(segment, height, 5))
      .filter((segment) => (
        segment.start >= Math.round(height * 0.06) &&
        segment.start <= Math.round(height * 0.78) &&
        segment.end - segment.start >= 7 &&
        segment.end - segment.start <= Math.max(42, Math.round(height * 0.13))
      ));

    for (const row of rows) {
      const card = lobbyOverviewCardFromRow(data, width, height, zoneRect, lane, row);
      if (card) cards.push(card);
    }
  }

  return mergeCards(cards);
}

function memberGridCard(zoneRect: Rect, zoneWidth: number, zoneHeight: number, laneStart: number, laneWidth: number, row: Segment): DetectedCard {
  const rowHeight = row.end - row.start + 1;
  const iconSize = Math.max(26, Math.min(38, Math.round(zoneHeight * 0.07)));
  const slotWidth = Math.round(laneWidth * 0.08);
  const iconX = zoneRect.x + laneStart + slotWidth + Math.round(laneWidth * 0.02);
  const iconY = zoneRect.y + Math.max(0, row.start + Math.round((rowHeight - iconSize) / 2));
  const nameX = iconX + iconSize + Math.round(laneWidth * 0.025);
  const nameY = zoneRect.y + Math.max(0, row.start - 2);
  const nameWidth = Math.max(48, Math.round(laneWidth * 0.46));
  const nameHeight = Math.max(16, Math.min(30, rowHeight + 6));
  const cardRect = {
    x: zoneRect.x + laneStart,
    y: zoneRect.y + Math.max(0, row.start - 5),
    width: Math.min(laneWidth, zoneWidth - laneStart),
    height: Math.max(22, rowHeight + 10)
  };

  return {
    rect: cardRect,
    cardRect,
    iconRect: clampRect({ x: iconX, y: iconY, width: iconSize, height: iconSize }, zoneRect),
    nameRect: clampRect({ x: nameX, y: nameY, width: nameWidth, height: nameHeight }, zoneRect),
    type: "roster-card",
    layoutType: "member-grid",
    confidence: 0.82
  };
}

function lobbyOverviewCardFromRow(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  zoneRect: Rect,
  lane: Segment,
  row: Segment
): DetectedCard | undefined {
  const colSignals = new Array<number>(lane.end - lane.start + 1).fill(0);
  for (let y = row.start; y <= row.end; y += 1) {
    for (let x = lane.start; x <= lane.end; x += 1) {
      const offset = (y * width + x) * 3;
      if (isWhiteNamePixel(data[offset], data[offset + 1], data[offset + 2])) colSignals[x - lane.start] += 1;
    }
  }

  const horizontalSegments = mergeNearbySegments(findSegments(colSignals, 1, 2), 5)
    .map((segment) => ({ start: lane.start + segment.start, end: lane.start + segment.end }))
    .filter((segment) => segment.end - segment.start + 1 >= 4);
  const selectedHorizontal = trimLeadingIconSegment(horizontalSegments, row.end - row.start + 1);
  if (!selectedHorizontal) return undefined;

  let left = selectedHorizontal.start;
  let right = selectedHorizontal.end;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let y = row.start; y <= row.end; y += 1) {
    for (let x = selectedHorizontal.start; x <= selectedHorizontal.end; x += 1) {
      const offset = (y * width + x) * 3;
      if (!isWhiteNamePixel(data[offset], data[offset + 1], data[offset + 2])) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return undefined;

  const laneWidth = lane.end - lane.start + 1;
  const rawName = {
    x: zoneRect.x + left,
    y: zoneRect.y + top,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1)
  };
  if (rawName.width < Math.max(20, Math.round(laneWidth * 0.08))) return undefined;

  const nameRect = expandRect(rawName, zoneRect, 9, 5);
  const iconSize = Math.max(28, Math.min(42, Math.round(Math.max(nameRect.height * 1.65, zoneRect.height * 0.07))));
  const iconRect = clampRect({
    x: zoneRect.x + Math.max(lane.start + Math.round(laneWidth * 0.04), left - iconSize - Math.round(laneWidth * 0.025)),
    y: zoneRect.y + Math.max(0, top + Math.round((rawName.height - iconSize) / 2)),
    width: iconSize,
    height: iconSize
  }, zoneRect);
  const cardRect = clampRect({
    x: zoneRect.x + lane.start,
    y: zoneRect.y + Math.max(0, row.start - Math.round(zoneRect.height * 0.04)),
    width: laneWidth,
    height: Math.max(iconSize + 8, row.end - row.start + 1 + Math.round(zoneRect.height * 0.08))
  }, zoneRect);
  const serverHeight = Math.max(10, Math.round(nameRect.height * 0.8));
  const serverRect = clampRect({
    x: nameRect.x,
    y: Math.max(zoneRect.y, nameRect.y - serverHeight - 5),
    width: Math.min(nameRect.width + Math.round(laneWidth * 0.12), zoneRect.x + lane.end - nameRect.x + 1),
    height: serverHeight
  }, zoneRect);
  const statusWidth = Math.max(24, Math.round(laneWidth * 0.16));
  const statusRect = clampRect({
    x: zoneRect.x + lane.end - statusWidth + 1,
    y: cardRect.y,
    width: statusWidth,
    height: cardRect.height
  }, zoneRect);

  return {
    rect: cardRect,
    cardRect,
    iconRect,
    nameRect,
    serverRect,
    statusRect,
    type: "roster-card",
    layoutType: "lobby-overview",
    confidence: 0.78
  };
}

function isWhiteNamePixel(red: number, green: number, blue: number): boolean {
  const brightness = (red + green + blue) / 3;
  const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
  return brightness >= 118 && spread <= 72;
}

function overviewLaneRowCounts(data: Buffer | Uint8Array, width: number, height: number): number[] {
  const laneGap = Math.round(width * 0.08);
  const laneWidth = Math.round((width - laneGap) / 2);
  const lanes = [
    { start: 0, end: Math.max(0, laneWidth - 1) },
    { start: Math.min(width - 1, laneWidth + laneGap), end: width - 1 }
  ];
  return lanes.map((lane) => {
    const signals = new Array<number>(height).fill(0);
    for (let y = Math.round(height * 0.06); y <= Math.round(height * 0.78); y += 1) {
      for (let x = lane.start; x <= lane.end; x += 1) {
        const offset = (y * width + x) * 3;
        if (isWhiteNamePixel(data[offset], data[offset + 1], data[offset + 2])) signals[y] += 1;
      }
    }
    const threshold = Math.max(4, Math.round((lane.end - lane.start + 1) * 0.018));
    return mergeNearbySegments(findSegments(signals, threshold, 3), 10)
      .filter((segment) => segment.end - segment.start >= 7 && segment.end - segment.start <= Math.max(42, Math.round(height * 0.13)))
      .length;
  });
}

function countWhiteNamePixels(data: Buffer | Uint8Array, width: number, height: number): number {
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      if (isWhiteNamePixel(data[offset], data[offset + 1], data[offset + 2])) count += 1;
    }
  }
  return count;
}

function partyLaneRowCounts(data: Buffer | Uint8Array, width: number, height: number): number[] {
  const laneWidth = Math.round(width * 0.42);
  const laneGap = Math.round(width * 0.08);
  const lanes = [
    { start: 0, end: Math.min(width - 1, laneWidth) },
    { start: Math.min(width - 1, laneWidth + laneGap), end: width - 1 }
  ];
  return lanes.map((lane) => {
    const signals = new Array<number>(height).fill(0);
    for (let y = Math.round(height * 0.08); y <= Math.round(height * 0.58); y += 1) {
      for (let x = lane.start; x <= lane.end; x += 1) {
        const offset = (y * width + x) * 3;
        const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        if (brightness >= 86) signals[y] += 1;
      }
    }
    const threshold = Math.max(4, Math.round((lane.end - lane.start + 1) * 0.025));
    return mergeNearbySegments(findSegments(signals, threshold, 3), 6)
      .filter((segment) => segment.end - segment.start >= 8 && segment.end - segment.start <= Math.round(height * 0.095))
      .length;
  });
}

function countBrightPixels(data: Buffer | Uint8Array, width: number, x: number, y: number, rectWidth: number, rectHeight: number): number {
  let count = 0;
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let col = x; col < x + rectWidth; col += 1) {
      const offset = (row * width + col) * 3;
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (brightness >= 86) count += 1;
    }
  }
  return count;
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

function cardRegions(cardRect: Rect, zoneRect: Rect): DetectedCard {
  const paddedCard = expandRect(cardRect, zoneRect, Math.round(cardRect.width * 0.1), Math.round(cardRect.height * 0.35));
  const iconSize = Math.max(14, Math.min(30, Math.round(paddedCard.height * 0.58)));
  const iconRect = {
    x: paddedCard.x,
    y: paddedCard.y + Math.max(0, Math.round((paddedCard.height - iconSize) / 2)),
    width: iconSize,
    height: iconSize
  };
  const statusWidth = Math.max(18, Math.round(paddedCard.width * 0.12));
  const statusRect = {
    x: paddedCard.x + paddedCard.width - statusWidth,
    y: paddedCard.y,
    width: statusWidth,
    height: paddedCard.height
  };
  const nameX = Math.min(paddedCard.x + paddedCard.width - 1, iconRect.x + iconRect.width + 4);
  const nameRight = Math.max(nameX + 1, statusRect.x - 2);
  const nameRect = {
    x: nameX,
    y: paddedCard.y,
    width: Math.max(1, nameRight - nameX),
    height: Math.max(1, Math.round(paddedCard.height * 0.58))
  };
  const serverRect = {
    x: nameX,
    y: nameRect.y + nameRect.height,
    width: nameRect.width,
    height: Math.max(1, paddedCard.y + paddedCard.height - (nameRect.y + nameRect.height))
  };

  return {
    rect: paddedCard,
    cardRect: paddedCard,
    iconRect,
    nameRect,
    serverRect,
    statusRect,
    type: "roster-card",
    confidence: 0.7
  };
}

function cardFromVisualCluster(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  zoneRect: Rect,
  band: Segment,
  col: Segment
): DetectedCard | undefined {
  const localHeight = band.end - band.start + 1;
  const lineSignals = new Array<number>(localHeight).fill(0);

  for (let y = band.start; y <= band.end; y += 1) {
    for (let x = col.start; x <= col.end; x += 1) {
      const offset = (y * width + x) * 3;
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (brightness >= 86) lineSignals[y - band.start] += 1;
    }
  }

  const lineThreshold = Math.max(2, Math.round((col.end - col.start + 1) * 0.035));
  const lines = mergeNearbySegments(findSegments(lineSignals, lineThreshold, 2), 3)
    .map((line) => ({ start: band.start + line.start, end: band.start + line.end }))
    .filter((line) => line.end - line.start >= 2);

  const lineRects = lines
    .map((line) => brightBoundsForLine(data, width, height, zoneRect, line, col))
    .filter((rect): rect is Rect => Boolean(rect))
    .filter((rect) => rect.width >= 18 && rect.height >= 3);

  if (lineRects.length === 0) return undefined;

  const selectedName = selectNameLine(lineRects);
  const serverRect = lineRects.find((rect) => rect.y < selectedName.y - 1);
  const textBounds = unionRects(lineRects);
  const cardLocal = {
    x: zoneRect.x + col.start,
    y: zoneRect.y + band.start,
    width: col.end - col.start + 1,
    height: band.end - band.start + 1
  };
  const cardRect = expandRect(unionRects([cardLocal, textBounds]), zoneRect, 8, 6);
  const nameRect = expandRect(selectedName, zoneRect, 8, 4);
  const iconSize = Math.max(22, Math.min(42, Math.round(Math.max(cardRect.height * 0.78, nameRect.height * 1.25))));
  const inferredIconX = nameRect.x - iconSize - 5;
  const iconX = inferredIconX >= cardRect.x ? inferredIconX : cardRect.x;
  const iconRect = {
    x: iconX,
    y: Math.max(zoneRect.y, nameRect.y + Math.round((nameRect.height - iconSize) / 2)),
    width: iconSize,
    height: iconSize
  };

  return {
    rect: cardRect,
    cardRect,
    iconRect,
    nameRect,
    serverRect: serverRect ? expandRect(serverRect, zoneRect, 6, 3) : undefined,
    statusRect: undefined,
    type: "roster-card",
    confidence: lineRects.length > 1 ? 0.78 : 0.68
  };
}

function brightBoundsForLine(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  zoneRect: Rect,
  line: Segment,
  col: Segment
): Rect | undefined {
  const lineColSignals = new Array<number>(col.end - col.start + 1).fill(0);

  for (let y = Math.max(0, line.start); y <= Math.min(height - 1, line.end); y += 1) {
    for (let x = Math.max(0, col.start); x <= Math.min(width - 1, col.end); x += 1) {
      const offset = (y * width + x) * 3;
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (brightness >= 82) lineColSignals[x - col.start] += 1;
    }
  }

  const horizontalSegments = findSegments(lineColSignals, 1, 2)
    .map((segment) => ({ start: col.start + segment.start, end: col.start + segment.end }));
  const selectedHorizontal = trimLeadingIconSegment(horizontalSegments, line.end - line.start + 1);
  if (!selectedHorizontal) return undefined;

  let left = selectedHorizontal.start;
  let right = selectedHorizontal.end;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (let y = Math.max(0, line.start); y <= Math.min(height - 1, line.end); y += 1) {
    for (let x = Math.max(0, selectedHorizontal.start); x <= Math.min(width - 1, selectedHorizontal.end); x += 1) {
      const offset = (y * width + x) * 3;
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (brightness < 82) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
    return undefined;
  }

  return {
    x: zoneRect.x + left,
    y: zoneRect.y + top,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1)
  };
}

function trimLeadingIconSegment(segments: Segment[], lineHeight: number): Segment | undefined {
  if (segments.length === 0) return undefined;
  if (segments.length === 1) return segments[0];

  const first = segments[0];
  const second = segments[1];
  const firstWidth = first.end - first.start + 1;
  const secondWidth = second.end - second.start + 1;
  const looksLikeIcon = firstWidth <= Math.max(18, Math.round(lineHeight * 2.8)) && secondWidth >= Math.max(10, firstWidth * 1.4);
  const textSegments = looksLikeIcon ? segments.slice(1) : segments;
  return {
    start: Math.min(...textSegments.map((segment) => segment.start)),
    end: Math.max(...textSegments.map((segment) => segment.end))
  };
}

function selectNameLine(lineRects: Rect[]): Rect {
  if (lineRects.length === 1) return lineRects[0];
  const sorted = [...lineRects].sort((left, right) => left.y - right.y || right.width - left.width);
  const lowerLines = sorted.slice(1).filter((rect) => rect.width >= Math.round(sorted[0].width * 0.35));
  if (lowerLines.length > 0) return lowerLines.sort((left, right) => right.width - left.width || right.y - left.y)[0];
  return sorted.sort((left, right) => right.width - left.width || right.y - left.y)[0];
}

function rectFromRelative(bounds: Rect, x: number, y: number, width: number, height: number): Rect {
  return {
    x: bounds.x + Math.round(bounds.width * x),
    y: bounds.y + Math.round(bounds.height * y),
    width: Math.max(1, Math.round(bounds.width * width)),
    height: Math.max(1, Math.round(bounds.height * height))
  };
}

interface Segment {
  start: number;
  end: number;
}

function findSegments(values: number[], threshold: number, minLength: number): Segment[] {
  const segments: Segment[] = [];
  let start: number | undefined;

  for (let index = 0; index < values.length; index += 1) {
    if (values[index] >= threshold) {
      start ??= index;
    } else if (start !== undefined) {
      if (index - start >= minLength) segments.push({ start, end: index - 1 });
      start = undefined;
    }
  }

  if (start !== undefined && values.length - start >= minLength) {
    segments.push({ start, end: values.length - 1 });
  }

  return segments;
}

function mergeNearbySegments(segments: Segment[], maxGap: number): Segment[] {
  const result: Segment[] = [];
  for (const segment of segments) {
    const previous = result.at(-1);
    if (previous && segment.start - previous.end <= maxGap) {
      previous.end = segment.end;
    } else {
      result.push({ ...segment });
    }
  }
  return result;
}

function expandSegment(segment: Segment, limit: number, padding: number): Segment {
  return {
    start: Math.max(0, segment.start - padding),
    end: Math.min(limit - 1, segment.end + padding)
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

function clampRect(rect: Rect, bounds: Rect): Rect {
  const x = Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - 1));
  const y = Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - 1));
  const right = Math.min(bounds.x + bounds.width, rect.x + rect.width);
  const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height);
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
    await mkdir(outputDir, { recursive: true });
    const imageName = parse(basename(imagePath)).name;
    const fileName = `${scanId ?? "manual"}-${imageName}-${label}.png`.replace(/[^\w.-]+/g, "_");
    await sharp(imagePath).extract(toSharpRect(rect)).png().toFile(join(outputDir, fileName));
  } catch (error) {
    logger?.warn("ocr.debugCrop.failed", { imagePath, rect, outputDir, label, error: String(error) });
  }
}

function toSharpRect(rect: Rect): SharpRegion {
  return {
    left: Math.max(0, Math.round(rect.x)),
    top: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
}
