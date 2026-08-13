import { execFileSync } from "node:child_process";

const source = process.env.DATABASE_URL;
if (!source) throw new Error("DATABASE_URL is required for deployment migrations.");

const databaseUrl = new URL(source);
if (databaseUrl.hostname.endsWith(".pooler.supabase.com") && databaseUrl.port === "6543") {
  databaseUrl.port = "5432";
}
databaseUrl.searchParams.delete("pgbouncer");

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl.toString(),
  PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
};

execFileSync(executable, ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: environment,
});
