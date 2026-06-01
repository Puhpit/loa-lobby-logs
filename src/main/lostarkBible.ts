import { lostArkBibleClassNames } from "./classMap.js";
import type {
  CharacterHeader,
  CharacterLogsQueryOptions,
  CharacterLogsResult,
  LogEntry,
  Region
} from "../shared/types.js";

const BASE_URL = "https://lostark.bible";
const SEARCH_ENDPOINT = `${BASE_URL}/_app/remote/ngsbie/search`;
const LATIN_BASE_CHARACTERS: Record<string, string> = {
  Æ: "AE",
  æ: "ae",
  Ð: "D",
  ð: "d",
  Đ: "D",
  đ: "d",
  Ł: "L",
  ł: "l",
  Ø: "O",
  ø: "o",
  Œ: "OE",
  œ: "oe",
  Þ: "Th",
  þ: "th"
};

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

export interface SearchCandidate {
  name: string;
  classKey?: string;
  itemLevel?: number;
}

export type LostArkBibleErrorCode =
  | "not_found"
  | "private_logs"
  | "rate_limited"
  | "session_required"
  | "api_shape"
  | "network"
  | "http_error";

export class LostArkBibleError extends Error {
  constructor(
    readonly code: LostArkBibleErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "LostArkBibleError";
  }
}

export class LostArkBibleProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getCharacterLogs(
    region: Region,
    name: string,
    options: number | CharacterLogsQueryOptions = {}
  ): Promise<CharacterLogsResult> {
    return this.getCharacterLogsInternal(region, name, options);
  }

  private async getCharacterLogsInternal(
    region: Region,
    name: string,
    options: number | CharacterLogsQueryOptions,
    resolvedFromSearch?: string
  ): Promise<CharacterLogsResult> {
    const { pages, bosses } = normalizeQueryOptions(options);
    let html: string;
    try {
      html = await this.fetchText(`${BASE_URL}/character/${region}/${encodeURIComponent(name)}/logs`);
    } catch (error) {
      if (error instanceof LostArkBibleError && error.code === "not_found" && !resolvedFromSearch) {
        const searchName = await this.searchCanonicalCharacterName(region, name).catch(() => undefined);
        if (searchName && searchName !== name) {
          return this.getCharacterLogsInternal(region, searchName, options, name);
        }
      }
      throw error;
    }
    let pageData: RawPageData;
    try {
      pageData = extractPageData(html);
    } catch (error) {
      if (!resolvedFromSearch) {
        const searchName = await this.searchCanonicalCharacterName(region, name).catch(() => undefined);
        if (searchName && searchName !== name) {
          return this.getCharacterLogsInternal(region, searchName, options, name);
        }
      }
      throw error instanceof LostArkBibleError
        ? error
        : new LostArkBibleError("api_shape", error instanceof Error ? error.message : String(error));
    }
    const header = pageData.header ? normalizeHeader(pageData.header) : undefined;
    const firstPageLogs = (pageData.logs ?? []).map(normalizeLogEntry);

    if (!header) {
      if (!resolvedFromSearch) {
        const searchName = await this.searchCanonicalCharacterName(region, name).catch(() => undefined);
        if (searchName && searchName !== name) {
          return this.getCharacterLogsInternal(region, searchName, options, name);
        }
      }
      throw new LostArkBibleError("not_found", `Character ${name} was not found on lostark.bible`);
    }

    if (!pageData.logsEnabled) {
      throw new LostArkBibleError("private_logs", `Character ${name} does not have public lostark.bible logs`);
    }

    const logs = bosses.length > 0 ? [] : [...firstPageLogs];
    const seen = new Set(logs.map((log) => log.id));
    const startPage = bosses.length > 0 || logs.length === 0 ? 1 : 2;

    for (let page = startPage; page <= pages; page++) {
      const pageLogs = await this.fetchLogPage(region, header, page, bosses);
      if (pageLogs.length === 0) break;

      let added = 0;
      for (const log of pageLogs) {
        if (!seen.has(log.id)) {
          seen.add(log.id);
          logs.push(log);
          added += 1;
        }
      }
      if (added === 0) break;
    }

    return {
      region,
      name,
      resolvedFromSearch,
      header,
      logsEnabled: true,
      isPublic: Boolean(pageData.isPublic),
      logs
    };
  }

  private async searchCanonicalCharacterName(region: Region, name: string): Promise<string | undefined> {
    const matches = new Map<string, SearchCandidate>();

    for (const query of searchQueriesForName(name)) {
      const payload = encodeSearchPayload(query, region);
      const response = await this.fetchImpl(`${SEARCH_ENDPOINT}?payload=${payload}`, {
        headers: { Accept: "application/json" }
      });

      if (!response.ok) continue;
      const data = await response.json() as unknown;
      for (const candidate of decodeSearchResultCandidates(data)) {
        if (strictRecoverableNameMatch(name, candidate.name)) {
          matches.set(candidate.name.toLowerCase(), candidate);
        }
      }
    }

    return matches.size === 1 ? [...matches.values()][0]?.name : undefined;
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
      throw errorForStatus(response.status, "lostark.bible logs request failed");
    }

    const data = await response.json() as unknown;
    if (!Array.isArray(data)) {
      throw new LostArkBibleError("api_shape", "lostark.bible logs API returned an unexpected payload");
    }
    return data.map(normalizeLogEntry);
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.fetchImpl(url, {
      headers: { Accept: "text/html,application/xhtml+xml" }
    });

    if (!response.ok) {
      throw errorForStatus(response.status, "lostark.bible page request failed");
    }

    return response.text();
  }
}

export function extractPageData(html: string): RawPageData {
  const bootData = extractSvelteKitDataArray(html) ?? html;
  const headerLiteral = extractLiteralAfterKey(bootData, "header");
  const logsLiteral = extractLogsLiteral(bootData);

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
  const propertyIndex = findPropertyIndex(input, key, 0);
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

function findPropertyIndex(input: string, key: string, start: number): number {
  for (let index = start; index < input.length; index++) {
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

function extractLogsLiteral(input: string): string | undefined {
  let searchFrom = 0;

  while (searchFrom < input.length) {
    const propertyIndex = findPropertyIndex(input, "logs", searchFrom);
    if (propertyIndex === -1) return undefined;

    const literal = extractLiteralAfterKey(input.slice(propertyIndex), "logs");
    if (literal?.startsWith("[") && literal.includes("boss") && literal.includes("dps")) return literal;
    searchFrom = propertyIndex + 4;
  }

  return undefined;
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
  for (const field of ["id", "name", "boss", "difficulty", "dps", "class", "duration", "timestamp"]) {
    if (log[field] === undefined || log[field] === null) {
      throw new LostArkBibleError("api_shape", `lostark.bible log entry is missing ${field}`);
    }
  }

  return {
    id: String(log.id),
    name: String(log.name),
    boss: String(log.boss),
    difficulty: String(log.difficulty),
    dps: Number(log.dps),
    bdps: optionalValueNumber(log.bdps),
    udps: optionalValueNumber(log.udps),
    ndps: optionalValueNumber(log.ndps),
    rdps: optionalValueNumber(log.rdps),
    rContribution: optionalValueNumber(log.rContribution),
    buffs: Array.isArray(log.buffs) ? log.buffs.map(Number) : undefined,
    className: String(log.class),
    spec: log.spec ? String(log.spec) : undefined,
    gearScore: optionalValueNumber(log.gearScore),
    combatPower: optionalValueNumber(log.combatPower),
    percentile: log.percentile === null || log.percentile === undefined ? null : Number(log.percentile),
    contributionPercentile:
      log.contributionPercentile === null || log.contributionPercentile === undefined
        ? null
        : Number(log.contributionPercentile),
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

export function encodeSearchPayload(name: string, region: Region): string {
  const json = JSON.stringify([["__skrao", 1], { name: 2, region: 3 }, name, region]);
  return base64UrlEncode(json);
}

export function decodeSearchResultNames(data: unknown): string[] {
  return decodeSearchResultCandidates(data).map((candidate) => candidate.name);
}

export function decodeSearchResultCandidates(data: unknown): SearchCandidate[] {
  const envelope = data as { type?: unknown; result?: unknown };
  if (envelope.type !== "result" || typeof envelope.result !== "string") return [];

  try {
    return uniqueSearchCandidates(collectSearchCandidates(JSON.parse(envelope.result)));
  } catch {
    return [];
  }
}

export function strictAccentVariantMatch(ocrName: string, candidate: string): boolean {
  return strictRecoverableNameMatch(ocrName, candidate, false);
}

export function strictRecoverableNameMatch(ocrName: string, candidate: string, allowConfusables = true): boolean {
  const ocrChars = Array.from(ocrName);
  const candidateChars = Array.from(candidate);
  if (ocrChars.length !== candidateChars.length) return false;

  return ocrChars.every((ocrChar, index) => {
    const candidateChar = candidateChars[index];
    return (
      candidateChar === ocrChar ||
      foldLatin(candidateChar).toLowerCase() === foldLatin(ocrChar).toLowerCase() ||
      (allowConfusables && areConfusableCharacters(ocrChar, candidateChar))
    );
  });
}

function base64UrlEncode(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").toString("base64url");
  }

  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function collectSearchCandidates(value: unknown): SearchCandidate[] {
  if (!Array.isArray(value)) {
    if (value && typeof value === "object") return Object.values(value).flatMap(collectSearchCandidates);
    return [];
  }

  const candidates: SearchCandidate[] = [];
  for (let index = 0; index < value.length - 2; index++) {
    const name = value[index];
    const classKey = value[index + 1];
    const itemLevel = value[index + 2];
    if (
      typeof name === "string" &&
      isLikelyCharacterName(name) &&
      typeof classKey === "string" &&
      typeof itemLevel === "number"
    ) {
      candidates.push({ name, classKey, itemLevel });
    }
  }

  return candidates.concat(value.flatMap(collectSearchCandidates));
}

function uniqueSearchCandidates(values: SearchCandidate[]): SearchCandidate[] {
  const seen = new Set<string>();
  const unique: SearchCandidate[] = [];
  for (const value of values) {
    const key = value.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function isLikelyCharacterName(value: string): boolean {
  return /^\p{L}[\p{L}\p{N}]{3,15}$/u.test(value);
}

function foldLatin(value: string): string {
  return Array.from(value)
    .map((char) => LATIN_BASE_CHARACTERS[char] ?? char)
    .join("")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function searchQueriesForName(name: string): string[] {
  const queries = new Set([name]);
  const chars = Array.from(name);

  for (let index = 0; index < chars.length && queries.size < 32; index++) {
    const group = confusableGroupForChar(chars[index]);
    if (!group) continue;
    for (const replacement of group) {
      if (replacement === chars[index]) continue;
      const next = [...chars];
      next[index] = replacement;
      queries.add(next.join(""));
      if (queries.size >= 32) break;
    }
  }

  return [...queries];
}

const CONFUSABLE_GROUPS = ["iIl1", "oO0", "sS5", "bB8"];

function areConfusableCharacters(left: string, right: string): boolean {
  const leftFolded = foldLatin(left);
  const rightFolded = foldLatin(right);
  if (leftFolded.length !== 1 || rightFolded.length !== 1) return false;
  return CONFUSABLE_GROUPS.some((group) => group.includes(leftFolded) && group.includes(rightFolded));
}

function confusableGroupForChar(char: string): string | undefined {
  const folded = foldLatin(char);
  if (folded.length !== 1) return undefined;
  return CONFUSABLE_GROUPS.find((group) => group.includes(folded));
}

function errorForStatus(status: number, prefix: string): LostArkBibleError {
  if (status === 401 || status === 403) {
    return new LostArkBibleError("session_required", `${prefix} with ${status}; lostark.bible may require a browser session`, status);
  }
  if (status === 404) {
    return new LostArkBibleError("not_found", `${prefix} with 404`, status);
  }
  if (status === 429) {
    return new LostArkBibleError("rate_limited", `${prefix} with 429; lostark.bible is rate limiting requests`, status);
  }
  return new LostArkBibleError("http_error", `${prefix} with ${status}`, status);
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
