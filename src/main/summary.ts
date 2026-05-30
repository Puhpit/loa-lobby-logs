import type { CharacterSummary, LogEntry } from "../shared/types.js";

export function summarizeCharacter(
  name: string,
  logs: LogEntry[],
  currentBosses: string[]
): CharacterSummary {
  const currentEncounterLogs = [...logs.filter((log) => currentBosses.includes(log.boss))]
    .sort(compareDisplayPriority);
  const currentIds = new Set(currentEncounterLogs.map((log) => log.id));
  const recentOtherLogs = [...logs.filter((log) => !currentIds.has(log.id))]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 5);
  const primaryLogs = currentEncounterLogs.length > 0 ? currentEncounterLogs : logs;

  const latest = logs.reduce<LogEntry | undefined>(
    (acc, log) => (!acc || log.timestamp > acc.timestamp ? log : acc),
    undefined
  );

  return {
    name,
    className: latest?.className,
    spec: latest?.spec,
    gearScore: latest?.gearScore,
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

function compareDisplayPriority(left: LogEntry, right: LogEntry): number {
  return (
    compareNullableDescending(left.percentile, right.percentile) ||
    right.dps - left.dps ||
    right.ndps - left.ndps ||
    right.timestamp - left.timestamp
  );
}

function compareNullableDescending(left: number | null | undefined, right: number | null | undefined): number {
  const leftValue = typeof left === "number" && !Number.isNaN(left) ? left : Number.NEGATIVE_INFINITY;
  const rightValue = typeof right === "number" && !Number.isNaN(right) ? right : Number.NEGATIVE_INFINITY;
  return rightValue - leftValue;
}
