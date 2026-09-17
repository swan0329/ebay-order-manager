// Applies only the additive catalogue migration during a reviewed deployment.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "../src/generated/prisma/index.js";
const name = "20260908170000_pocamarket_catalog_discovery";
const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("DATABASE_URL is required.");
const url = new URL(raw);
if (url.hostname.endsWith(".pooler.supabase.com")) { url.port = "5432"; url.searchParams.delete("pgbouncer"); }
url.searchParams.set("connection_limit", "1");
const prisma = new PrismaClient({ datasourceUrl: url.toString() });
let applied = false;
try {
  const rows = await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations
    WHERE migration_name=${name} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  applied = rows.length > 0;
  if (!applied) {
    const sql = readFileSync(new URL(`./migrations/${name}/migration.sql`, import.meta.url), "utf8");
    await prisma.$transaction(async (tx) => {
      for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    }, { timeout: 30000 });
  }
} finally { await prisma.$disconnect(); }
if (!applied) execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "resolve", "--applied", name],
  { stdio: "inherit", env: { ...process.env, DATABASE_URL: url.toString() } });
console.log("Catalogue discovery migration ready.");
