import { join } from "node:path";
import type { CalibrationConfig } from "./calibration.js";
import { ScreenshotCharacterSource } from "./ocrCharacterSource.js";
import { LostArkBibleProvider } from "./lostarkBible.js";
import { summarizeLobbyCharacters } from "./lobbySummary.js";
import { CachedLogProvider } from "./summaryCache.js";
import { RateLimitedLogProvider } from "./rateLimit.js";
import type { ReviewLobbyInput, ReviewLobbyOutput } from "../shared/appTypes.js";
import type { CharacterCandidate, CharacterSummary } from "../shared/types.js";

export interface AppPipelineOptions {
  userDataPath: string;
  calibration: CalibrationConfig;
  fetchImpl?: typeof fetch;
}

export async function reviewLobby(input: ReviewLobbyInput, options: AppPipelineOptions): Promise<ReviewLobbyOutput> {
  const candidates = input.useScreenshotOcr && input.screenshotPath
    ? await new ScreenshotCharacterSource({
        imagePath: input.screenshotPath,
        calibration: options.calibration,
        sourceMode: "applicant-list"
      }).getVisibleApplicants()
    : [];

  const candidateNames = candidates.map((candidate) => candidate.normalizedName);
  const logProvider = new CachedLogProvider(
    new RateLimitedLogProvider(new LostArkBibleProvider(options.fetchImpl ?? fetch)),
    join(options.userDataPath, "cache", "logs.json")
  );

  const result = await summarizeLobbyCharacters({
    region: input.region,
    visibleEncounterText: input.visibleEncounterText,
    characterNames: [...input.manualNames, ...candidateNames],
    logProvider,
    pages: input.pages
  });

  return {
    encounter: result.encounter,
    candidates,
    summaries: applyOcrFlags(result.characters, candidates),
    generatedAt: new Date().toISOString()
  };
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
