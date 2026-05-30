import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildLogsRequestBody, extractPageData, LostArkBibleProvider } from "../src/main/lostarkBible.js";
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
});
