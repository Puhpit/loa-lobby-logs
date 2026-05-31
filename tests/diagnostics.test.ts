import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createDiagnosticsLogger } from "../src/main/diagnostics.js";

describe("createDiagnosticsLogger", () => {
  it("writes JSONL diagnostics and redacts sensitive keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "loa-lobby-logs-test-"));
    const logger = createDiagnosticsLogger(dir);

    logger.info("test.event", {
      name: "Pepegami",
      authorization: "Bearer secret",
      nested: { cookie: "session=value" }
    });

    await waitForLogWrite();
    const [line] = (await readFile(logger.logPath, "utf8")).trim().split("\n");
    const entry = JSON.parse(line) as {
      event: string;
      data: { authorization: string; nested: { cookie: string } };
    };

    expect(entry.event).toBe("test.event");
    expect(entry.data.authorization).toBe("[redacted]");
    expect(entry.data.nested.cookie).toBe("[redacted]");
  });
});

function waitForLogWrite(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}
