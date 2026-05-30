export type Region = "NA" | "CE" | "NAW" | "NAE";

export type OcrSourceMode =
  | "applicant-list"
  | "other-party-selected-lobby"
  | "own-recruitment-lobby";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CharacterCandidate {
  rawText: string;
  normalizedName: string;
  confidence: number;
  sourceMode: OcrSourceMode;
  cropRect: Rect;
}

export interface CharacterHeader {
  id: number;
  serial: string;
  rosterId: number;
  classKey: string;
  className: string;
  itemLevel?: number;
  world?: string;
}

export interface LogEntry {
  id: string;
  name: string;
  boss: string;
  difficulty: string;
  dps: number;
  udps?: number;
  ndps: number;
  rdps?: number;
  buffs?: number[];
  className: string;
  spec?: string;
  gearScore?: number;
  combatPower?: number;
  percentile: number | null;
  overallPercentile?: number | null;
  duration: number;
  timestamp: number;
  isBus: boolean;
  isDead: boolean;
}

export interface CharacterLogsResult {
  region: Region;
  name: string;
  header?: CharacterHeader;
  logsEnabled: boolean;
  isPublic: boolean;
  logs: LogEntry[];
}

export interface CharacterLogsQueryOptions {
  pages?: number;
  bosses?: string[];
}

export interface CharacterSummary {
  name: string;
  className?: string;
  spec?: string;
  gearScore?: number;
  currentEncounterLogs: LogEntry[];
  recentOtherLogs: LogEntry[];
  bestPercentile: number | null;
  medianPercentile: number | null;
  bestDps: number | null;
  medianDps: number | null;
  medianNdps: number | null;
  latestTimestamp: number | null;
  flags: SummaryFlag[];
}

export type SummaryFlag =
  | "no-public-logs"
  | "character-not-found"
  | "session-expired"
  | "ocr-uncertain"
  | "scrape-failed"
  | "rate-limited"
  | "no-encounter-match";

export interface CharacterSource {
  getVisibleApplicants(): Promise<CharacterCandidate[]>;
}

export interface LogProvider {
  getCharacterLogs(
    region: Region,
    name: string,
    options?: CharacterLogsQueryOptions
  ): Promise<CharacterLogsResult>;
}
