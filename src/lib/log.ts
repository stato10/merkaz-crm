/**
 * Structured JSON logger. One line per event so any log pipeline (Vercel,
 * Datadog, Loki, CloudWatch) can index fields without parsing prose.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? order.info;

function serializeError(e: unknown) {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
  return { message: String(e) };
}

function write(level: Level, msg: string, fields: Fields) {
  if (order[level] < min || process.env.LOG_SILENT === "1") return;
  const { err, ...rest } = fields;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...rest,
    ...(err !== undefined ? { err: serializeError(err) } : {}),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export type Logger = {
  debug: (msg: string, f?: Fields) => void;
  info: (msg: string, f?: Fields) => void;
  warn: (msg: string, f?: Fields) => void;
  error: (msg: string, f?: Fields) => void;
  child: (f: Fields) => Logger;
};

function make(base: Fields): Logger {
  return {
    debug: (m, f = {}) => write("debug", m, { ...base, ...f }),
    info: (m, f = {}) => write("info", m, { ...base, ...f }),
    warn: (m, f = {}) => write("warn", m, { ...base, ...f }),
    error: (m, f = {}) => write("error", m, { ...base, ...f }),
    child: (f) => make({ ...base, ...f }),
  };
}

export const log = make({ service: "crm" });
