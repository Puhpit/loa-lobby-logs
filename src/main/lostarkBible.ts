import { lostArkBibleClassNames } from "./classMap.js";
import type { CharacterHeader, CharacterLogsResult, LogEntry, Region } from "../shared/types.js";

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

  async getCharacterLogs(region: Region, name: string, pages = 3): Promise<CharacterLogsResult> {
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

    const logs = [...firstPageLogs];
    const seen = new Set(logs.map((log) => log.id));

    for (let page = 2; page <= pages; page++) {
      const pageLogs = await this.fetchLogPage(region, header, page);
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

  private async fetchLogPage(region: Region, header: CharacterHeader, page: number): Promise<LogEntry[]> {
    const response = await this.fetchImpl(`${BASE_URL}/api/character/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region,
        characterSerial: header.serial,
        className: header.className,
        cid: header.id,
        rid: header.rosterId,
        page
      })
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
  const headerMatch = html.match(/header:\{(?<body>.*?guild:\{.*?\}\})/s);
  const logsMatch = html.match(/logs:\[(?<logs>.*?)(?=\],uses:\{|\],\w+:)/s);

  const header = headerMatch?.groups?.body ? parseHeaderObject(headerMatch.groups.body) : undefined;
  const logs = logsMatch?.groups?.logs ? parseEmbeddedLogs(logsMatch.groups.logs) : [];

  return {
    header,
    logsEnabled: html.includes("logsEnabled:true"),
    isPublic: html.includes("isPublic:true"),
    logs
  };
}

function parseHeaderObject(body: string): RawHeader {
  const id = Number(requiredMatch(body, /id:(\d+)/, "header.id"));
  const sn = requiredMatch(body, /sn:"([^"]+)"/, "header.sn");
  const rid = Number(requiredMatch(body, /rid:(\d+)/, "header.rid"));
  const classKey = requiredMatch(body, /class:"([^"]+)"/, "header.class");
  const ilvl = optionalNumber(body, /ilvl:(\d+(?:\.\d+)?)/);
  const world = optionalString(body, /world:"([^"]+)"/);

  return { id, sn, rid, ilvl, class: classKey, world };
}

function parseEmbeddedLogs(logsBody: string): unknown[] {
  const jsonish = `[${logsBody}]`
    .replace(/([{,])(\w+):/g, '$1"$2":')
    .replace(/:\.([0-9]+)/g, ":0.$1");

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
