import type { CharacterDisplayMetrics, CharacterSummary, LogEntry, PercentileBadge } from "../shared/types.js";

export interface SummaryEncounterContext {
  bosses: string[];
  difficulty?: string;
}
const SUPPORT_SPECS = new Set(["Desperate Salvation", "Full Bloom", "Blessed Aura", "Liberator"]);
const SUPPORT_PERFORMANCE_COLORS = ["#fca5a5", "#86efac", "#fde047", "#93c5fd"];

export function summarizeCharacter(
  name: string,
  logs: LogEntry[],
  encounter: string[] | SummaryEncounterContext
): CharacterSummary {
  const context = Array.isArray(encounter) ? { bosses: encounter } : encounter;
  const currentEncounterLogs = [...logs.filter((log) => matchesEncounter(log, context))]
    .sort((left, right) => right.timestamp - left.timestamp);
  const currentIds = new Set(currentEncounterLogs.map((log) => log.id));
  const recentOtherLogs = [...logs.filter((log) => !currentIds.has(log.id))]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 5);
  const primaryLogs = currentEncounterLogs.length > 0 ? currentEncounterLogs : logs;
  const recentEncounterLogs = currentEncounterLogs.slice(0, 6);
  const selectedLog = recentEncounterLogs[0] ?? [...logs].sort((left, right) => right.timestamp - left.timestamp)[0];

  const latest = logs.reduce<LogEntry | undefined>(
    (acc, log) => (!acc || log.timestamp > acc.timestamp ? log : acc),
    undefined
  );

  return {
    name,
    className: latest?.className,
    spec: latest?.spec,
    gearScore: latest?.gearScore,
    selectedLog,
    recentEncounterLogs,
    displayMetrics: selectedLog ? displayMetricsForLog(selectedLog) : undefined,
    currentEncounterLogs,
    recentOtherLogs,
    bestPercentile: maxNullable(primaryLogs.map((log) => log.percentile)),
    medianPercentile: medianNullable(primaryLogs.map((log) => log.percentile)),
    bestDps: maxNullable(primaryLogs.map((log) => log.dps)),
    medianDps: medianNullable(primaryLogs.map((log) => log.dps)),
    medianNdps: medianNullable(primaryLogs.map((log) => log.ndps)),
    latestTimestamp: latest?.timestamp ?? null,
    flags: [
      ...(logs.length === 0 ? (["no-public-logs"] as const) : []),
      ...(currentEncounterLogs.length === 0 && logs.length > 0 ? (["no-encounter-match"] as const) : [])
    ]
  };
}

export function displayMetricsForLog(log: LogEntry): CharacterDisplayMetrics {
  if (isSupportLog(log)) {
    const buffs = log.buffs ?? [];
    return {
      role: "support",
      percentileBadges: [percentileBadge(log.contributionPercentile), percentileBadge(log.percentile)].filter(
        (badge): badge is PercentileBadge => Boolean(badge)
      ),
      performance: ["AP", "Brand", "Identity", "T"].map((label, index) => ({
        label,
        value: typeof buffs[index] === "number" ? `${Math.round(buffs[index] * 100)}` : "-",
        color: SUPPORT_PERFORMANCE_COLORS[index]
      })),
      ndps: {
        label: "rDPS",
        marker: "r",
        value: typeof log.rContribution === "number" ? `${(log.rContribution * 100).toFixed(1)}%` : "-"
      }
    };
  }

  return {
    role: "dps",
    percentileBadges: [percentileBadge(log.percentile)].filter((badge): badge is PercentileBadge => Boolean(badge)),
    performance: [{ label: "DPS", value: formatCompactNumber(log.dps) }],
    ndps: {
      label: typeof log.ndps === "number" ? "nDPS" : "uDPS",
      marker: typeof log.ndps === "number" ? "n" : typeof log.udps === "number" ? "u" : undefined,
      value: formatCompactNumber(typeof log.ndps === "number" ? log.ndps : log.udps)
    }
  };
}

export function isSupportLog(log: LogEntry): boolean {
  return Boolean(log.spec && SUPPORT_SPECS.has(log.spec));
}

export function percentileBadge(value: number | null | undefined): PercentileBadge | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  const label = String(Math.floor(value * 100));
  const percentile = Number(label);

  if (percentile === 100) return { value, label, textColor: "#dcc999", backgroundColor: "#e5cc80" };
  if (percentile === 99) return { value, label, textColor: "#FF69B4", backgroundColor: "#ee59a5" };
  if (percentile >= 95) return { value, label, textColor: "#FFA441", backgroundColor: "#ff8000" };
  if (percentile >= 75) return { value, label, textColor: "#ce84ff", backgroundColor: "#a75ed5" };
  if (percentile >= 50) return { value, label, textColor: "#0096ff", backgroundColor: "#0096ff" };
  if (percentile >= 25) return { value, label, textColor: "#3dd351", backgroundColor: "#3dd351" };
  return { value, label, textColor: "#afafaf", backgroundColor: "#6a6a6a" };
}

function matchesEncounter(log: LogEntry, encounter: SummaryEncounterContext): boolean {
  if (encounter.bosses.length === 0) return false;
  if (!encounter.bosses.includes(log.boss)) return false;
  if (!encounter.difficulty) return true;
  return normalizeDifficulty(log.difficulty) === normalizeDifficulty(encounter.difficulty);
}

function normalizeDifficulty(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function formatCompactNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function maxNullable(values: Array<number | null | undefined>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
  return numbers.length ? Math.max(...numbers) : null;
}

function medianNullable(values: Array<number | null | undefined>): number | null {
  const numbers = values
    .filter((value): value is number => typeof value === "number" && !Number.isNaN(value))
    .sort((a, b) => a - b);

  if (numbers.length === 0) return null;

  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 0 ? (numbers[middle - 1] + numbers[middle]) / 2 : numbers[middle];
}
