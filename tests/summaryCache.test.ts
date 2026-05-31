import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { cacheKey, CachedLogProvider } from "../src/main/summaryCache.js";
import type { CharacterLogsResult, LogProvider, Region } from "../src/shared/types.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("cacheKey", () => {
  it("normalizes names and boss order", () => {
    expect(cacheKey("NA", " Pepegami ", { pages: 2, bosses: ["B", "A"] })).toBe(
      cacheKey("NA", "pepegami", { pages: 2, bosses: ["A", "B"] })
    );
  });
});

describe("CachedLogProvider", () => {
  it("returns cached log results within the ttl window", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "loa-cache-"));
    let calls = 0;
    const inner: LogProvider = {
      async getCharacterLogs(region: Region, name: string): Promise<CharacterLogsResult> {
        calls += 1;
        return { region, name, logsEnabled: true, isPublic: true, logs: [] };
      }
    };
    const provider = new CachedLogProvider(inner, join(tempDir, "logs.json"), 60_000);

    await provider.getCharacterLogs("NA", "Pepegami", { pages: 1 });
    await provider.getCharacterLogs("NA", "Pepegami", { pages: 1 });

    expect(calls).toBe(1);
  });
});
