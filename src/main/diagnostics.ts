import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEntry {
  level: DiagnosticLevel;
  event: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface DiagnosticsLogger {
  readonly logPath: string;
  info(event: string, data?: Record<string, unknown>, message?: string): void;
  warn(event: string, data?: Record<string, unknown>, message?: string): void;
  error(event: string, error?: unknown, data?: Record<string, unknown>): void;
}

export function createDiagnosticsLogger(logDirectory: string): DiagnosticsLogger {
  const logPath = join(logDirectory, "diagnostics.jsonl");

  function write(entry: DiagnosticEntry): void {
    void mkdir(logDirectory, { recursive: true })
      .then(() => appendFile(logPath, `${JSON.stringify(formatEntry(entry))}\n`, "utf8"))
      .catch(() => {
        // Avoid recursive logging failures. The UI exposes the log path for manual inspection.
      });
  }

  return {
    logPath,
    info: (event, data, message) => write({ level: "info", event, data, message }),
    warn: (event, data, message) => write({ level: "warn", event, data, message }),
    error: (event, error, data) => write({
      level: "error",
      event,
      message: errorMessage(error),
      data: {
        ...data,
        ...(error instanceof Error ? { name: error.name, stack: error.stack } : {})
      }
    })
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatEntry(entry: DiagnosticEntry): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    level: entry.level,
    event: entry.event,
    ...(entry.message ? { message: entry.message } : {}),
    ...(entry.data ? { data: redact(entry.data) } : {})
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|cookie|authorization|password|secret/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redact(nested);
    }
  }
  return result;
}
