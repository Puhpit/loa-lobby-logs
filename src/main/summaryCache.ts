import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CharacterLogsQueryOptions,
  CharacterLogsResult,
  LogProvider,
  Region
} from "../shared/types.js";

interface CacheEntry {
  expiresAt: number;
  result: CharacterLogsResult;
}

interface CacheFile {
  entries: Record<string, CacheEntry>;
}

export class CachedLogProvider implements LogProvider {
  constructor(
    private readonly inner: LogProvider,
    private readonly cachePath: string,
    private readonly ttlMs = 10 * 60 * 1000
  ) {}

  async getCharacterLogs(
    region: Region,
    name: string,
    options: CharacterLogsQueryOptions = {}
  ): Promise<CharacterLogsResult> {
    const key = cacheKey(region, name, options);
    const cache = await readCache(this.cachePath);
    const cached = cache.entries[key];

    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const result = await this.inner.getCharacterLogs(region, name, options);
    cache.entries[key] = { expiresAt: Date.now() + this.ttlMs, result };
    await writeCache(this.cachePath, cache);
    return result;
  }
}

export function cacheKey(region: Region, name: string, options: CharacterLogsQueryOptions): string {
  return JSON.stringify({
    region,
    name: name.trim().toLowerCase(),
    pages: options.pages ?? 3,
    bosses: [...(options.bosses ?? [])].sort()
  });
}

async function readCache(path: string): Promise<CacheFile> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as CacheFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: {} };
    return { entries: {} };
  }
}

async function writeCache(path: string, cache: CacheFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}
