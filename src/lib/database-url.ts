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

  if (url.hostname.endsWith(".pooler.supabase.com")) {
    if (!url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }

    if (url.searchParams.get("sslmode") !== "require") {
      url.searchParams.set("sslmode", "require");
    }

    process.env.DATABASE_URL = url.toString();
  }
}
