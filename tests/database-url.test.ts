import { afterEach, describe, expect, it } from "vitest";
import { normalizeDatabaseUrlForPrisma } from "../src/lib/database-url";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("normalizeDatabaseUrlForPrisma", () => {
  it("adds Prisma pooler options for Supabase pooler URLs", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres.example:secret@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres";

    normalizeDatabaseUrlForPrisma();

    const url = new URL(process.env.DATABASE_URL ?? "");
    expect(url.username).toBe("postgres.example");
    expect(url.hostname).toBe("aws-1-ap-southeast-2.pooler.supabase.com");
    expect(url.port).toBe("6543");
    expect(url.searchParams.get("pgbouncer")).toBe("true");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("adds Prisma pooler options for Supabase transaction pooler URLs", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres:secret@db.example.supabase.co:6543/postgres";

    normalizeDatabaseUrlForPrisma();

    const url = new URL(process.env.DATABASE_URL ?? "");
    expect(url.searchParams.get("pgbouncer")).toBe("true");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("adds SSL mode without pgbouncer for Supabase direct URLs", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres:secret@db.example.supabase.co:5432/postgres";

    normalizeDatabaseUrlForPrisma();

    const url = new URL(process.env.DATABASE_URL ?? "");
    expect(url.searchParams.get("pgbouncer")).toBeNull();
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("does not alter non-pooler URLs", () => {
    const directUrl = "postgresql://user:secret@db.example.com:5432/app";
    process.env.DATABASE_URL = directUrl;

    normalizeDatabaseUrlForPrisma();

    expect(process.env.DATABASE_URL).toBe(directUrl);
  });
});
