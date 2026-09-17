import { execFileSync } from "node:child_process";
import { PrismaClient } from "../src/generated/prisma/index.js";

const SHOPIFY_ORDERS_MIGRATION = "20260831010000_shopify_orders";

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

const prisma = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
let shouldResolveFailedMigration = false;

try {
  const [migrationTable] = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public._prisma_migrations')::text AS "tableName"`,
  );

  if (migrationTable?.tableName) {
    const failedMigrations = await prisma.$queryRawUnsafe(
      `SELECT migration_name
       FROM "_prisma_migrations"
       WHERE migration_name = $1
         AND finished_at IS NULL
         AND rolled_back_at IS NULL`,
      SHOPIFY_ORDERS_MIGRATION,
    );
    shouldResolveFailedMigration = failedMigrations.length > 0;

    if (shouldResolveFailedMigration) {
      const columns = await prisma.$queryRawUnsafe(
        `SELECT column_name AS "columnName", data_type AS "dataType", is_nullable AS "isNullable"
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'orders'
           AND column_name IN ('ebay_order_id', 'sales_channel', 'external_order_id', 'order_number')
         ORDER BY ordinal_position`,
      );
      console.log("Detected a failed Shopify orders migration; existing order columns:", columns);
    }
  }
} finally {
  await prisma.$disconnect();
}

if (shouldResolveFailedMigration) {
  execFileSync(
    executable,
    ["prisma", "migrate", "resolve", "--rolled-back", SHOPIFY_ORDERS_MIGRATION],
    { stdio: "inherit", env: environment },
  );
}

execFileSync(executable, ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: environment,
});
