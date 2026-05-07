type LogLevel = "info" | "warn" | "error";

export function safeLog(
  level: LogLevel,
  event: string,
  data: Record<string, unknown> = {},
) {
  console[level](
    JSON.stringify({
      event,
      ...data,
    }),
  );
}
