import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { catalogProductData, fetchCatalogPage, nextCatalogRun, type CatalogGroupId } from "@/lib/pocamarket-catalog-api";

type CatalogState = { group_id: CatalogGroupId; brand: string; enabled: boolean; status: string;
  next_page: number; total_count: number; scanned_count: number; created_count: number; total_created: number;
  error_message: string | null; last_completed_at: Date | null; next_run_at: Date; updated_at: Date };

export async function getCatalogStates() {
  return prisma.$queryRaw<CatalogState[]>`SELECT group_id, brand, enabled, status, next_page,
    total_count, scanned_count, created_count, total_created, error_message,
    last_completed_at, next_run_at, updated_at FROM pocamarket_catalog_states ORDER BY group_id`;
}

export async function requestCatalogScan() {
  // A second click resumes the saved page; it never resets an active scan to page 1.
  await prisma.$executeRaw`UPDATE pocamarket_catalog_states SET enabled=TRUE, next_run_at=NOW(),
    updated_at=NOW()`;
}

export async function setCatalogEnabled(enabled: boolean) {
  await prisma.$executeRaw`UPDATE pocamarket_catalog_states SET enabled=${enabled},
    next_run_at=CASE WHEN ${enabled} THEN LEAST(next_run_at,NOW()) ELSE next_run_at END, updated_at=NOW()`;
}

export async function runCatalogChunk() {
  const token = randomUUID();
  const states = await prisma.$queryRaw<CatalogState[]>`
    UPDATE pocamarket_catalog_states SET lease_token=${token}, lease_until=NOW()+INTERVAL '90 seconds',
      scanned_count=CASE WHEN status='COMPLETED' THEN 0 ELSE scanned_count END,
      created_count=CASE WHEN status='COMPLETED' THEN 0 ELSE created_count END,
      status='RUNNING', error_message=NULL, updated_at=NOW()
    WHERE group_id=(SELECT group_id FROM pocamarket_catalog_states
      WHERE enabled=TRUE AND next_run_at<=NOW() AND (lease_until IS NULL OR lease_until<NOW())
      ORDER BY updated_at,group_id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`;
  const state = states[0];
  if (!state) return { processedPages: 0, created: 0, shouldContinue: false };
  const started = Date.now();
  let page = state.next_page;
  let processedPages = 0;
  let created = 0;
  let failed = false;
  try {
    while (processedPages < 8 && Date.now() - started < 24000) {
      const result = await fetchCatalogPage(state.group_id, page);
      const cards = result.results.map((card) => ({ id: randomUUID(), ...catalogProductData(card, state.group_id) }));
      const inserted = await prisma.$transaction(async (tx) => {
        // Lock and validate the lease before any product write, including after a user pauses.
        const owned = await tx.$queryRaw<Array<{ group_id: number }>>`SELECT group_id FROM pocamarket_catalog_states
          WHERE group_id=${state.group_id} AND lease_token=${token} AND enabled=TRUE FOR UPDATE`;
        if (!owned.length) throw new Error("신상품 수집이 일시정지되었거나 다른 작업에서 재개되었습니다.");
        const skus = cards.map((card) => card.sku);
        const existing = skus.length ? await tx.product.findMany({
          where: { OR: [{ sku: { in: skus } }, { pocamarketId: { in: skus } }] },
          select: { sku: true, pocamarketId: true },
        }) : [];
        const used = new Set(existing.flatMap((product) => [product.sku, product.pocamarketId]));
        const fresh = cards.filter((card) => !used.has(card.sku));
        const added = fresh.length ? await tx.product.createMany({ data: fresh, skipDuplicates: true }) : { count: 0 };
        if (fresh.length) {
          const ids = Prisma.join(fresh.map((card) => card.id));
          await tx.$executeRaw`UPDATE products SET source_image_url=image_url, image_source='pocamarket' WHERE id IN (${ids})`;
          await tx.$executeRaw`INSERT INTO ai_image_jobs (id,product_id,source_url,status)
            SELECT gen_random_uuid()::text,id,image_url,
              CASE WHEN COALESCE(pocamarket_available_count,0)>0 THEN 'queued' ELSE 'waiting_supply' END
            FROM products WHERE id IN (${ids}) ON CONFLICT (product_id) DO NOTHING`;
        }
        const done = result.next_page === null;
        await tx.$executeRaw`UPDATE pocamarket_catalog_states SET next_page=${result.next_page ?? 1},
          total_count=${result.count}, scanned_count=scanned_count+${cards.length},
          created_count=created_count+${added.count}, total_created=total_created+${added.count},
          status=${done ? "COMPLETED" : "RUNNING"},
          last_completed_at=CASE WHEN ${done} THEN NOW() ELSE last_completed_at END,
          next_run_at=${done ? nextCatalogRun() : new Date()}, updated_at=NOW()
          WHERE group_id=${state.group_id} AND lease_token=${token}`;
        return added.count;
      }, { timeout: 12000, maxWait: 5000 });
      created += inserted;
      processedPages++;
      if (result.next_page === null) break;
      page = result.next_page;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    failed = true;
    const message = error instanceof Error && (error.message.startsWith("포카마켓") || error.message.startsWith("신상품"))
      ? error.message : "신상품 수집 중 연결 오류가 발생했습니다. 저장된 페이지부터 다시 시도합니다.";
    await prisma.$executeRaw`UPDATE pocamarket_catalog_states SET status='RETRY', error_message=${message},
      next_run_at=NOW()+INTERVAL '1 hour',updated_at=NOW()
      WHERE group_id=${state.group_id} AND lease_token=${token}`;
  } finally {
    await prisma.$executeRaw`UPDATE pocamarket_catalog_states SET lease_token=NULL,lease_until=NULL,
      updated_at=NOW() WHERE group_id=${state.group_id} AND lease_token=${token}`;
  }
  const [pending] = await prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count
    FROM pocamarket_catalog_states WHERE enabled=TRUE AND next_run_at<=NOW()
      AND (lease_until IS NULL OR lease_until<NOW())`;
  return { processedPages, created, failed, shouldContinue: pending.count > 0 };
}

export async function continueCatalogScan() {
  try {
    // Each scheduled invocation handles one bounded chunk. Never recursively call
    // our HTTP route: Vercel propagates recursion context to outbound requests.
    const result = await runCatalogChunk();
    console.info(JSON.stringify({ event: "pocamarket.catalog.chunk", ...result }));
  } catch (error) {
    // The durable cursor and expiring lease let the next scheduled run recover.
    console.error("Catalog worker will retry on schedule", error instanceof Error ? error.name : "UnknownError");
  }
}
