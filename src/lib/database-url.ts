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
