import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildLogsRequestBody,
  decodeSearchResultCandidates,
  decodeSearchResultNames,
  encodeSearchPayload,
  extractPageData,
  LostArkBibleError,
  LostArkBibleProvider,
  strictAccentVariantMatch,
  strictRecoverableNameMatch
} from "../src/main/lostarkBible.js";
import type { CharacterHeader } from "../src/shared/types.js";

const fixtureUrl = new URL("./fixtures/pepegami-page.html", import.meta.url);
const logsFixtureUrl = new URL("./fixtures/pepegami-logs-page-1.json", import.meta.url);

async function readFixture(url: URL): Promise<string> {
  return readFile(fileURLToPath(url), "utf8");
}

describe("LostArkBibleProvider page extraction", () => {
  it("extracts the embedded character header", async () => {
    const pageData = extractPageData(await readFixture(fixtureUrl));

    expect(pageData.header).toEqual({
      id: 22864512,
      sn: "200000000063884",
      rid: 219368,
      ilvl: 1765,
      class: "elemental_master",
      world: "Brelshaza"
    });
    expect(pageData.logsEnabled).toBe(true);
    expect(pageData.isPublic).toBe(true);
  });

  it("keeps the class key needed for class-name mapping", async () => {
    const requests: RequestInfo[] = [];
    const bodies: unknown[] = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push(input as RequestInfo);
      if (init?.body) bodies.push(JSON.parse(String(init.body)) as unknown);

      if (String(input).endsWith("/api/character/logs")) {
        return Response.json([]);
      }

      return new Response(await readFixture(fixtureUrl), { status: 200 });
    };

    const result = await new LostArkBibleProvider(fetchMock as typeof fetch).getCharacterLogs("NA", "Pepegami", 2);

    expect(result.header?.classKey).toBe("elemental_master");
    expect(result.header?.className).toBe("Sorceress");
    expect(requests.map(String)).toEqual([
      "https://lostark.bible/character/NA/Pepegami/logs",
      "https://lostark.bible/api/character/logs"
    ]);
    expect(bodies).toEqual([
      {
        region: "NA",
        characterSerial: "200000000063884",
        className: "Sorceress",
        cid: 22864512,
        rid: 219368,
        page: 2
      }
    ]);
  });

  it("fetches filtered boss pages when bosses are provided", async () => {
    const bodies: unknown[] = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).endsWith("/api/character/logs")) {
        bodies.push(JSON.parse(String(init?.body)) as unknown);
        return Response.json([]);
      }

      return new Response(await readFixture(fixtureUrl), { status: 200 });
    };

    await new LostArkBibleProvider(fetchMock as typeof fetch).getCharacterLogs("NA", "Pepegami", {
      pages: 1,
      bosses: ["Armoche, Sentinel of the Abyss"]
    });

    expect(bodies).toEqual([
      {
        region: "NA",
        characterSerial: "200000000063884",
        className: "Sorceress",
        cid: 22864512,
        rid: 219368,
        bosses: ["Armoche, Sentinel of the Abyss"],
        page: 1
      }
    ]);
  });

  it("extracts embedded page-one logs", async () => {
    const pageData = extractPageData(await readFixture(fixtureUrl));
    const expectedLogs = JSON.parse(await readFixture(logsFixtureUrl)) as unknown[];

    expect(pageData.logs).toEqual(expectedLogs);
  });

  it("builds the page-two POST body shape", () => {
    const header: CharacterHeader = {
      id: 22864512,
      serial: "200000000063884",
      rosterId: 219368,
      classKey: "elemental_master",
      className: "Sorceress",
      itemLevel: 1765,
      world: "Brelshaza"
    };

    expect(buildLogsRequestBody("NA", header, 2)).toEqual({
      region: "NA",
      characterSerial: "200000000063884",
      className: "Sorceress",
      cid: 22864512,
      rid: 219368,
      page: 2
    });
  });

  it("starts at API page one when embedded logs are absent", async () => {
    const bodies: unknown[] = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).endsWith("/api/character/logs")) {
        bodies.push(JSON.parse(String(init?.body)) as unknown);
        return Response.json([]);
      }

      return new Response(minimalPage({ logsLiteral: "[]" }), { status: 200 });
    };

    await new LostArkBibleProvider(fetchMock as typeof fetch).getCharacterLogs("NA", "Pepegami", 2);

    expect(bodies).toEqual([
      {
        region: "NA",
        characterSerial: "200000000063884",
        className: "Sorceress",
        cid: 22864512,
        rid: 219368,
        page: 1
      }
    ]);
  });

  it("throws concrete errors for private or missing characters", async () => {
    const privateProvider = new LostArkBibleProvider((async () =>
      new Response(minimalPage({ logsEnabled: false }), { status: 200 })) as typeof fetch);
    const missingProvider = new LostArkBibleProvider((async () =>
      new Response("no character here", { status: 200 })) as typeof fetch);

    await expect(privateProvider.getCharacterLogs("NA", "Astery")).rejects.toMatchObject({
      code: "private_logs"
    });
    await expect(missingProvider.getCharacterLogs("NA", "DefinitelyMissing")).rejects.toMatchObject({
      code: "not_found"
    });
  });

  it("throws typed errors for rate limits and invalid API payloads", async () => {
    const rateLimitedProvider = new LostArkBibleProvider((async () =>
      new Response("too many", { status: 429 })) as typeof fetch);
    await expect(rateLimitedProvider.getCharacterLogs("NA", "Pepegami")).rejects.toMatchObject({
      code: "rate_limited",
      status: 429
    });

    const invalidApiProvider = new LostArkBibleProvider((async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/character/logs")) return Response.json({ nope: true });
      return new Response(minimalPage({ logsLiteral: "[]" }), { status: 200 });
    }) as typeof fetch);

    await expect(invalidApiProvider.getCharacterLogs("NA", "Pepegami")).rejects.toBeInstanceOf(LostArkBibleError);
    await expect(invalidApiProvider.getCharacterLogs("NA", "Pepegami")).rejects.toMatchObject({
      code: "api_shape"
    });
  });

  it("decodes search results and retries exact accent recovery after a missing direct lookup", async () => {
    const requests: string[] = [];
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      requests.push(url);

      if (url.endsWith("/character/NA/Freak/logs")) return new Response("missing", { status: 404 });
      if (url.startsWith("https://lostark.bible/_app/remote/ngsbie/search")) {
        expect(url).toContain(encodeSearchPayload("Freak", "NA"));
        return Response.json({
          type: "result",
          result: JSON.stringify([[1], [2, 3, 4], "Frëak", "arcana", 1766.67, [5], "Frëakk", "arcana", 1766, [6], "Fraek", "arcana", 1766])
        });
      }
      if (url.endsWith("/character/NA/Fr%C3%ABak/logs")) return new Response(minimalPage(), { status: 200 });
      if (url.endsWith("/api/character/logs")) return Response.json([]);
      throw new Error(`Unexpected URL ${url}`);
    };

    const result = await new LostArkBibleProvider(fetchMock as typeof fetch).getCharacterLogs("NA", "Freak", 1);

    expect(result.name).toBe("Frëak");
    expect(result.resolvedFromSearch).toBe("Freak");
    expect(requests).toContain("https://lostark.bible/character/NA/Freak/logs");
    expect(requests).toContain("https://lostark.bible/character/NA/Fr%C3%ABak/logs");
  });

  it("strict accent recovery rejects length changes, swaps, and substitutions", () => {
    expect(decodeSearchResultNames({ type: "result", result: JSON.stringify([[1], [2, 3, 4], "Frëak", "arcana", 1766.67]) })).toEqual(["Frëak"]);
    expect(strictAccentVariantMatch("Freak", "Frëak")).toBe(true);
    expect(strictAccentVariantMatch("Freak", "Frëakk")).toBe(false);
    expect(strictAccentVariantMatch("Freak", "Fëark")).toBe(false);
    expect(strictAccentVariantMatch("Freak", "Fraek")).toBe(false);
  });

  it("decodes search records with class and item level", () => {
    expect(decodeSearchResultCandidates({
      type: "result",
      result: JSON.stringify([[1], [2, 3, 4], "Iamboneofmysword", "hawk_eye", 1795])
    })).toEqual([{ name: "Iamboneofmysword", classKey: "hawk_eye", itemLevel: 1795 }]);
  });

  it("falls back to search when the direct page header is unparseable", async () => {
    const requests: string[] = [];
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/character/NA/lamboneofmysword/logs")) return new Response("header: { nope: true }", { status: 200 });
      if (url.includes(encodeSearchPayload("Iamboneofmysword", "NA"))) {
        return Response.json({ type: "result", result: JSON.stringify([[1], [2, 3, 4], "Iamboneofmysword", "hawk_eye", 1795]) });
      }
      if (url.startsWith("https://lostark.bible/_app/remote/ngsbie/search")) {
        return Response.json({ type: "result", result: JSON.stringify([[]]) });
      }
      if (url.endsWith("/character/NA/Iamboneofmysword/logs")) return new Response(minimalPage(), { status: 200 });
      if (url.endsWith("/api/character/logs")) return Response.json([]);
      throw new Error(`Unexpected URL ${url}`);
    };

    const result = await new LostArkBibleProvider(fetchMock as typeof fetch).getCharacterLogs("NA", "lamboneofmysword", 1);

    expect(result.name).toBe("Iamboneofmysword");
    expect(result.resolvedFromSearch).toBe("lamboneofmysword");
    expect(requests).toContain("https://lostark.bible/character/NA/Iamboneofmysword/logs");
  });

  it("uses conservative confusable recovery only when unambiguous", () => {
    expect(strictRecoverableNameMatch("lamboneofmysword", "Iamboneofmysword")).toBe(true);
    expect(strictRecoverableNameMatch("Bors", "8or5")).toBe(true);
    expect(strictRecoverableNameMatch("Freak", "Fraek")).toBe(false);
  });

  it("fails safely when confusable search recovery is ambiguous", async () => {
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/character/NA/Blab/logs")) return new Response("missing", { status: 404 });
      if (url.startsWith("https://lostark.bible/_app/remote/ngsbie/search")) {
        return Response.json({
          type: "result",
          result: JSON.stringify([[1], [2, 3, 4], "BIab", "hawk_eye", 1795, [5], [6, 7, 8], "B1ab", "arcana", 1790])
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    };

    await expect(new LostArkBibleProvider(fetchMock as typeof fetch).getCharacterLogs("NA", "Blab", 1)).rejects.toMatchObject({
      code: "not_found"
    });
  });
});

function minimalPage(options: { logsEnabled?: boolean; logsLiteral?: string } = {}): string {
  const logsEnabled = options.logsEnabled ?? true;
  const logsLiteral = options.logsLiteral ?? "[{id:\"one\",name:\"Pepegami\",boss:\"Boss\",difficulty:\"Hard\",dps:1,ndps:1,class:\"Sorceress\",duration:1,timestamp:1,isBus:false,isDead:false,percentile:.5}]";

  return `
    <script>
      kit.start({
        data: [{
          header: { id: 22864512, sn: "200000000063884", rid: 219368, ilvl: 1765, class: "elemental_master", world: "Brelshaza" },
          logsEnabled: ${logsEnabled},
          isPublic: true,
          logs: ${logsLiteral}
        }]
      });
    </script>
  `;
}
