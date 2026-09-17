export function normalizeDatabaseUrlForPrisma() {
  const raw = process.env.DATABASE_URL;

  if (!raw) {
    return;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }

  normalizeLegacySupabasePoolerUrl(url);

  if (isSupabaseDatabaseUrl(url) && url.searchParams.get("sslmode") !== "require") {
    url.searchParams.set("sslmode", "require");
  }

  if (isSupabasePoolerUrl(url)) {
    if (!url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
    // Serverless + pgbouncer: cap connections PER function instance so a burst
    // of concurrent invocations (e.g. a product list loading many images at
    // once) can't exhaust Supabase's pooler ("FATAL: max client connections").
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "1");
    }
    // Give a queued query more room to wait for the single connection before
    // failing with P2024. Image matching pages its scan now (short holds), so a
    // briefly-queued poll should comfortably acquire the connection within this.
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "40");
    }
  }

  process.env.DATABASE_URL = url.toString();
}

function normalizeLegacySupabasePoolerUrl(url: URL) {
  if (!url.hostname.endsWith(".pooler.supabase.com")) {
    return;
  }

  if (!decodeURIComponent(url.username).includes(".")) {
    return;
  }

  url.port = "6543";
}

function isSupabaseDatabaseUrl(url: URL) {
  return (
    url.hostname.endsWith(".pooler.supabase.com") ||
    (url.hostname.startsWith("db.") && url.hostname.endsWith(".supabase.co"))
  );
}

function isSupabasePoolerUrl(url: URL) {
  return (
    url.hostname.endsWith(".pooler.supabase.com") ||
    (url.hostname.startsWith("db.") &&
      url.hostname.endsWith(".supabase.co") &&
      url.port === "6543")
  );
}
