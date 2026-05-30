import type { CharacterLogsQueryOptions, CharacterLogsResult, LogProvider, Region } from "../shared/types.js";

export class RateLimitedLogProvider implements LogProvider {
  private nextStart = Promise.resolve();

  constructor(
    private readonly inner: LogProvider,
    private readonly minIntervalMs = 450
  ) {}

  async getCharacterLogs(
    region: Region,
    name: string,
    options?: CharacterLogsQueryOptions
  ): Promise<CharacterLogsResult> {
    const previous = this.nextStart;
    let release: () => void = () => undefined;
    this.nextStart = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await this.inner.getCharacterLogs(region, name, options);
    } finally {
      setTimeout(release, this.minIntervalMs);
    }
  }
}
