export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = String(input);
    const options: RequestInit & { targetAddressSpace?: "local" } = {
      ...init,
      signal: controller.signal,
    };
    if (
      url.startsWith("https://localhost:") ||
      url.startsWith("http://localhost:") ||
      url.startsWith("http://127.0.0.1:")
    ) {
      // Chrome 142+ uses this annotation to request Local Network Access
      // permission and exempt the known local destination from mixed-content
      // blocking.
      options.targetAddressSpace = "local";
    }
    return await fetch(input, options);
  } finally {
    window.clearTimeout(timer);
  }
}
