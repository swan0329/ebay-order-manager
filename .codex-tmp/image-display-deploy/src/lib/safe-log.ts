type LogLevel = "info" | "warn" | "error";

function isSensitiveStringKey(key: string) {
  const normalized = key.toLowerCase();

  return (
    normalized === "code" ||
    normalized === "authorization" ||
    normalized === "password" ||
    normalized.includes("secret") ||
    normalized.endsWith("token") ||
    normalized.endsWith("_token")
  );
}

function redactSensitiveValues(value: unknown, key = ""): unknown {
  if (typeof value === "string" && isSensitiveStringKey(key)) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSensitiveValues(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

export function safeLog(
  level: LogLevel,
  event: string,
  data: Record<string, unknown> = {},
) {
  const sanitizedData = redactSensitiveValues(data) as Record<string, unknown>;

  console[level](
    JSON.stringify({
      event,
      ...sanitizedData,
    }),
  );
}
