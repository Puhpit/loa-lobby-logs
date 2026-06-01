export type Region = "NA" | "CE";

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
  bdps?: number;
  udps?: number;
  ndps?: number;
  rdps?: number;
  rContribution?: number;
  buffs?: number[];
  className: string;
  spec?: string;
  gearScore?: number;
  combatPower?: number;
  percentile: number | null;
  contributionPercentile?: number | null;
  overallPercentile?: number | null;
  duration: number;
  timestamp: number;
  isBus: boolean;
  isDead: boolean;
}

export interface CharacterLogsResult {
  region: Region;
  name: string;
  resolvedFromSearch?: string;
  header?: CharacterHeader;
  logsEnabled: boolean;
  isPublic: boolean;
  logs: LogEntry[];
}

export interface PercentileBadge {
  value: number;
  label: string;
  textColor: string;
  backgroundColor: string;
}

export interface SelectedLogMetric {
  label: string;
  value: string;
  marker?: string;
  color?: string;
}

export interface CharacterDisplayMetrics {
  role: "dps" | "support";
  percentileBadges: PercentileBadge[];
  performance: SelectedLogMetric[];
  ndps: SelectedLogMetric;
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
  selectedLog?: LogEntry;
  recentEncounterLogs: LogEntry[];
  displayMetrics?: CharacterDisplayMetrics;
  currentEncounterLogs: LogEntry[];
  recentOtherLogs: LogEntry[];
  bestPercentile: number | null;
  medianPercentile: number | null;
  bestDps: number | null;
  medianDps: number | null;
  medianNdps: number | null;
  latestTimestamp: number | null;
  flags: SummaryFlag[];
  errorMessage?: string;
}

export type SummaryFlag =
  | "no-public-logs"
  | "character-not-found"
  | "session-expired"
  | "ocr-uncertain"
  | "ocr-search-corrected"
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
