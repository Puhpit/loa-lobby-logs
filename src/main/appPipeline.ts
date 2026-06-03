import { join } from "node:path";
import type { CalibrationConfig } from "./calibration.js";
import type { DiagnosticsLogger } from "./diagnostics.js";
import { ScreenshotCharacterSource } from "./ocrCharacterSource.js";
import { LostArkBibleProvider } from "./lostarkBible.js";
import { summarizeLobbyCharacters } from "./lobbySummary.js";
import { CachedLogProvider } from "./summaryCache.js";
import { RateLimitedLogProvider } from "./rateLimit.js";
import type { ReviewLobbyInput, ReviewLobbyOutput } from "../shared/appTypes.js";
import type { CharacterCandidate, CharacterSummary } from "../shared/types.js";

export interface AppPipelineOptions {
  userDataPath: string;
  calibration?: CalibrationConfig;
  fetchImpl?: typeof fetch;
  logger?: DiagnosticsLogger;
  scanId?: string;
}

export async function reviewLobby(input: ReviewLobbyInput, options: AppPipelineOptions): Promise<ReviewLobbyOutput> {
  options.logger?.info("pipeline.review.start", {
    scanId: options.scanId,
    region: input.region,
    manualNames: input.manualNames,
    screenshotPath: input.screenshotPath,
    useScreenshotOcr: input.useScreenshotOcr,
    ocrCandidateCount: input.ocrCandidates?.length ?? 0,
    pages: input.pages,
    visibleEncounterText: input.visibleEncounterText
  });

  const candidates = input.ocrCandidates ?? (input.useScreenshotOcr && input.screenshotPath
      ? await new ScreenshotCharacterSource({
        imagePath: input.screenshotPath,
        calibration: requiredCalibration(options.calibration),
        sourceMode: "character-list",
        logger: options.logger,
        scanId: options.scanId,
        debugOutputDir: join(process.cwd(), "local", "debug-ocr")
      }).getVisibleApplicants()
    : []);

  const candidateNames = candidates.map((candidate) => candidate.normalizedName);
  const logProvider = new CachedLogProvider(
    new RateLimitedLogProvider(new LostArkBibleProvider(options.fetchImpl ?? createLoggingFetch(fetch, options.logger, options.scanId))),
    join(options.userDataPath, "cache", "logs.json")
  );

  const result = await summarizeLobbyCharacters({
    region: input.region,
    visibleEncounterText: input.visibleEncounterText,
    characterNames: [...input.manualNames, ...candidateNames],
    logProvider,
    pages: input.pages
  });

  const output = {
    encounter: result.encounter,
    candidates,
    summaries: applyOcrFlags(result.characters, candidates),
    generatedAt: new Date().toISOString()
  };

  options.logger?.info("pipeline.review.done", {
    scanId: options.scanId,
    encounter: output.encounter,
    candidates: output.candidates.map((candidate) => candidate.normalizedName),
    summaries: output.summaries.map((summary) => ({
      name: summary.name,
      flags: summary.flags,
      errorMessage: summary.errorMessage,
      bestPercentile: summary.bestPercentile,
      bestDps: summary.bestDps,
      medianNdps: summary.medianNdps
    }))
  });

  return output;
}

function requiredCalibration(calibration: CalibrationConfig | undefined): CalibrationConfig {
  if (!calibration) throw new Error("Calibration is required for screenshot OCR");
  return calibration;
}

function applyOcrFlags(summaries: CharacterSummary[], candidates: CharacterCandidate[]): CharacterSummary[] {
  const uncertain = new Set(
    candidates
      .filter((candidate) => candidate.confidence < 0.75)
      .map((candidate) => candidate.normalizedName.toLowerCase())
  );

  return summaries.map((summary) => {
    if (!uncertain.has(summary.name.toLowerCase()) || summary.flags.includes("ocr-uncertain")) return summary;
    return { ...summary, flags: [...summary.flags, "ocr-uncertain"] };
  });
}

function createLoggingFetch(fetchImpl: typeof fetch, logger: DiagnosticsLogger | undefined, scanId: string | undefined): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startedAt = Date.now();
    const url = String(input);

    try {
      const response = await fetchImpl(input, init);
      logger?.info("lostark.request", {
        scanId,
        url,
        method: init?.method ?? "GET",
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt
      });
      return response;
    } catch (error) {
      logger?.error("lostark.request.error", error, {
        scanId,
        url,
        method: init?.method ?? "GET",
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }) as typeof fetch;
}
