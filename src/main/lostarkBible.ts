import { lostArkBibleClassNames } from "./classMap.js";
import type {
  CharacterHeader,
  CharacterLogsQueryOptions,
  CharacterLogsResult,
  LogEntry,
  Region
} from "../shared/types.js";

const BASE_URL = "https://lostark.bible";

interface RawHeader {
  id: number;
  sn: string;
  rid: number;
  ilvl?: number;
  class: string;
  world?: string;
}

interface RawPageData {
  header?: RawHeader;
  logsEnabled?: boolean;
  isPublic?: boolean;
  logs?: unknown[];
}

export class LostArkBibleProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getCharacterLogs(
    region: Region,
    name: string,
    options: number | CharacterLogsQueryOptions = {}
  ): Promise<CharacterLogsResult> {
    const { pages, bosses } = normalizeQueryOptions(options);
    const html = await this.fetchText(`${BASE_URL}/character/${region}/${encodeURIComponent(name)}/logs`);
    const pageData = extractPageData(html);
    const header = pageData.header ? normalizeHeader(pageData.header) : undefined;
    const firstPageLogs = (pageData.logs ?? []).map(normalizeLogEntry);

    if (!header || !pageData.logsEnabled) {
      return {
        region,
        name,
        header,
        logsEnabled: Boolean(pageData.logsEnabled),
        isPublic: Boolean(pageData.isPublic),
        logs: firstPageLogs
      };
    }

    const logs = bosses.length > 0 ? [] : [...firstPageLogs];
    const seen = new Set(logs.map((log) => log.id));
    const startPage = bosses.length > 0 ? 1 : 2;

    for (let page = startPage; page <= pages; page++) {
      const pageLogs = await this.fetchLogPage(region, header, page, bosses);
      if (pageLogs.length === 0) break;

      for (const log of pageLogs) {
        if (!seen.has(log.id)) {
          seen.add(log.id);
          logs.push(log);
        }
      }
    }

    return {
      region,
      name,
      header,
      logsEnabled: true,
      isPublic: Boolean(pageData.isPublic),
      logs
    };
  }

  private async fetchLogPage(
    region: Region,
    header: CharacterHeader,
    page: number,
    bosses: string[]
  ): Promise<LogEntry[]> {
    const response = await this.fetchImpl(`${BASE_URL}/api/character/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildLogsRequestBody(region, header, page, bosses))
    });

    if (!response.ok) {
      throw new Error(`lostark.bible logs request failed with ${response.status}`);
    }

    const data = (await response.json()) as unknown[];
    return data.map(normalizeLogEntry);
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.fetchImpl(url, {
      headers: { Accept: "text/html,application/xhtml+xml" }
    });

    if (!response.ok) {
      throw new Error(`lostark.bible page request failed with ${response.status}`);
    }

    return response.text();
  }
}

export function extractPageData(html: string): RawPageData {
  const bootData = extractSvelteKitDataArray(html) ?? html;
  const headerLiteral = extractLiteralAfterKey(bootData, "header");
  const logsLiteral = extractLiteralAfterKey(bootData, "logs");

  return {
    header: headerLiteral ? parseHeaderObject(headerLiteral) : undefined,
    logsEnabled: parseBooleanProperty(bootData, "logsEnabled"),
    isPublic: parseBooleanProperty(bootData, "isPublic"),
    logs: logsLiteral ? parseEmbeddedLogs(logsLiteral) : []
  };
}

export function buildLogsRequestBody(
  region: Region,
  header: CharacterHeader,
  page: number,
  bosses: string[] = []
): Record<string, unknown> {
  return {
    region,
    characterSerial: header.serial,
    className: header.className,
    cid: header.id,
    rid: header.rosterId,
    ...(bosses.length > 0 ? { bosses } : {}),
    page
  };
}

function normalizeQueryOptions(options: number | CharacterLogsQueryOptions): Required<CharacterLogsQueryOptions> {
  if (typeof options === "number") {
    return { pages: options, bosses: [] };
  }

  return {
    pages: options.pages ?? 3,
    bosses: options.bosses ?? []
  };
}

function extractSvelteKitDataArray(html: string): string | undefined {
  const startToken = "kit.start(";
  let searchFrom = 0;

  while (searchFrom < html.length) {
    const kitStart = html.indexOf(startToken, searchFrom);
    if (kitStart === -1) return undefined;

    const callStart = html.indexOf("(", kitStart);
    const callLiteral = extractBalancedLiteral(html, callStart);
    if (!callLiteral) {
      searchFrom = kitStart + startToken.length;
      continue;
    }

    const dataLiteral = extractLiteralAfterKey(callLiteral, "data");
    if (dataLiteral?.startsWith("[")) return dataLiteral;

    searchFrom = kitStart + callLiteral.length;
  }

  return undefined;
}

function extractLiteralAfterKey(input: string, key: string): string | undefined {
  const propertyIndex = findPropertyIndex(input, key);
  if (propertyIndex === -1) return undefined;

  const colonIndex = input.indexOf(":", propertyIndex + key.length);
  if (colonIndex === -1) return undefined;

  const valueStart = findNextNonWhitespace(input, colonIndex + 1);
  if (valueStart === -1) return undefined;

  const first = input[valueStart];
  if (first === "{" || first === "[" || first === "(") return extractBalancedLiteral(input, valueStart);
  if (first === '"' || first === "'" || first === "`") return extractQuotedLiteral(input, valueStart);

  const primitiveEnd = findPrimitiveEnd(input, valueStart);
  return input.slice(valueStart, primitiveEnd).trim();
}

function findPropertyIndex(input: string, key: string): number {
  for (let index = 0; index < input.length; index++) {
    const char = input[index];

    if (char === '"' || char === "'" || char === "`") {
      index = skipQuoted(input, index);
      continue;
    }

    if (!startsWithProperty(input, index, key)) continue;

    const afterKey = findNextNonWhitespace(input, index + key.length);
    if (afterKey !== -1 && input[afterKey] === ":") return index;
  }

  return -1;
}

function startsWithProperty(input: string, index: number, key: string): boolean {
  if (!input.startsWith(key, index)) return false;

  const before = input[index - 1];
  const after = input[index + key.length];
  const isIdentifier = (value: string | undefined): boolean => Boolean(value?.match(/[A-Za-z0-9_$]/));

  return !isIdentifier(before) && !isIdentifier(after);
}

function extractBalancedLiteral(input: string, start: number): string | undefined {
  const open = input[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : open === "(" ? ")" : undefined;
  if (!close) return undefined;

  let depth = 0;
  for (let index = start; index < input.length; index++) {
    const char = input[index];

    if (char === '"' || char === "'" || char === "`") {
      index = skipQuoted(input, index);
      continue;
    }

    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth === 0) return input.slice(start, index + 1);
  }

  return undefined;
}

function extractQuotedLiteral(input: string, start: number): string | undefined {
  const end = skipQuoted(input, start);
  return end < input.length ? input.slice(start, end + 1) : undefined;
}

function skipQuoted(input: string, start: number): number {
  const quote = input[start];
  for (let index = start + 1; index < input.length; index++) {
    const char = input[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === quote) return index;
  }

  return input.length;
}

function findNextNonWhitespace(input: string, start: number): number {
  for (let index = start; index < input.length; index++) {
    if (!input[index].match(/\s/)) return index;
  }

  return -1;
}

function findPrimitiveEnd(input: string, start: number): number {
  for (let index = start; index < input.length; index++) {
    if ([",", "}", "]", ")"].includes(input[index])) return index;
  }

  return input.length;
}

function parseBooleanProperty(input: string, key: string): boolean | undefined {
  const literal = extractLiteralAfterKey(input, key);
  if (literal === "true") return true;
  if (literal === "false") return false;
  return undefined;
}

function parseHeaderObject(literal: string): RawHeader {
  const id = Number(requiredMatch(literal, /\bid\s*:\s*(\d+)/, "header.id"));
  const sn = requiredMatch(literal, /\bsn\s*:\s*"([^"]+)"/, "header.sn");
  const rid = Number(requiredMatch(literal, /\brid\s*:\s*(\d+)/, "header.rid"));
  const classKey = requiredMatch(literal, /\bclass\s*:\s*"([^"]+)"/, "header.class");
  const ilvl = optionalNumber(literal, /\bilvl\s*:\s*(\d+(?:\.\d+)?)/);
  const world = optionalString(literal, /\bworld\s*:\s*"([^"]+)"/);

  return { id, sn, rid, ilvl, class: classKey, world };
}

function parseEmbeddedLogs(logsLiteral: string): unknown[] {
  const jsonish = logsLiteral
    .replace(/([{,])\s*([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/:\s*\.([0-9]+)/g, ":0.$1")
    .replace(/:\s*undefined\b/g, ":null");

  try {
    return JSON.parse(jsonish) as unknown[];
  } catch {
    return [];
  }
}

function normalizeHeader(header: RawHeader): CharacterHeader {
  return {
    id: header.id,
    serial: header.sn,
    rosterId: header.rid,
    classKey: header.class,
    className: lostArkBibleClassNames[header.class] ?? header.class,
    itemLevel: header.ilvl,
    world: header.world
  };
}

function normalizeLogEntry(value: unknown): LogEntry {
  const log = value as Record<string, unknown>;
  return {
    id: String(log.id),
    name: String(log.name),
    boss: String(log.boss),
    difficulty: String(log.difficulty),
    dps: Number(log.dps),
    udps: optionalValueNumber(log.udps),
    ndps: Number(log.ndps),
    rdps: optionalValueNumber(log.rdps),
    buffs: Array.isArray(log.buffs) ? log.buffs.map(Number) : undefined,
    className: String(log.class),
    spec: log.spec ? String(log.spec) : undefined,
    gearScore: optionalValueNumber(log.gearScore),
    combatPower: optionalValueNumber(log.combatPower),
    percentile: log.percentile === null || log.percentile === undefined ? null : Number(log.percentile),
    overallPercentile:
      log.overallPercentile === null || log.overallPercentile === undefined
        ? null
        : Number(log.overallPercentile),
    duration: Number(log.duration),
    timestamp: Number(log.timestamp),
    isBus: Boolean(log.isBus),
    isDead: Boolean(log.isDead)
  };
}

function requiredMatch(input: string, pattern: RegExp, fieldName: string): string {
  const match = input.match(pattern)?.[1];
  if (!match) throw new Error(`Could not parse ${fieldName} from lostark.bible page data`);
  return match;
}

function optionalString(input: string, pattern: RegExp): string | undefined {
  return input.match(pattern)?.[1];
}

function optionalNumber(input: string, pattern: RegExp): number | undefined {
  const value = input.match(pattern)?.[1];
  return value ? Number(value) : undefined;
}

function optionalValueNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}
