import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();
try {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name IN (
        'ebay_order_id', 'sales_channel', 'external_order_id', 'order_number'
      )
    ORDER BY ordinal_position
  `);
  const indexes = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'orders'
      AND (
        indexname LIKE '%sales_channel%' OR indexname LIKE '%external_order_id%'
      )
    ORDER BY indexname
  `);
  const migrations = await prisma.$queryRawUnsafe(`
    SELECT migration_name, started_at, finished_at, rolled_back_at,
           logs IS NOT NULL AS has_logs
    FROM "_prisma_migrations"
    WHERE migration_name = '20260831010000_shopify_orders'
    ORDER BY started_at DESC
  `);
  const counts = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE external_order_id IS NULL)::int AS external_id_nulls
    FROM orders
  `);
  console.log(JSON.stringify({ columns, indexes, migrations, counts }, null, 2));
} finally {
  await prisma.$disconnect();
}
