import "server-only";

import { prisma } from "@/lib/prisma";
import { listObjectsFromR2, r2KeyFromPublicUrl } from "@/lib/r2";

export type R2UsageGroup = {
  group: string;
  objectCount: number;
  bytes: number;
  unusedCount: number;
  unusedBytes: number;
  // 참조 없는 파일을 만들어진 지 얼마나 됐는지로 나눈다. 오래된 것부터 지우는
  // 판단에 쓴다.
  unusedOlderThan90dCount: number;
  unusedOlderThan90dBytes: number;
  unusedOlderThan30dCount: number;
  unusedOlderThan30dBytes: number;
  newestUnusedAt: string | null;
};

export type R2UsageReport = {
  scanned: number;
  bytes: number;
  unusedCount: number;
  unusedBytes: number;
  groups: R2UsageGroup[];
  cursor: string | null;
  referencedKeys: number;
};

// 상품·묶음별로 키가 갈라지므로 앞 경로만으로는 묶이지 않는다. 사람이 읽고
// 판단할 수 있는 단위로 모은다.
const DAY_MS = 24 * 60 * 60 * 1000;

const PRODUCT_SHARED_FOLDERS = new Set([
  "channel-watermarked",
  "channel-watermark-previews",
  "variation-thumbnails",
  "bts-approved-photos",
  "ebay-watermarked",
]);

export function r2UsageGroupOf(key: string) {
  const parts = key.split("/");
  if (parts[0] !== "products") return parts[0] || "(루트)";
  if (parts.length < 3) return "products/(기타)";
  if (PRODUCT_SHARED_FOLDERS.has(parts[1])) return `products/${parts[1]}`;
  // products/<상품번호>/<파일>. 상품 대표 이미지는 상품번호와 파일명이 같다.
  const file = parts[parts.length - 1];
  return file === `${parts[1]}.jpg`
    ? "products/상품 대표 이미지"
    : "products/상품별 과거 작업본";
}

/**
 * 지금 화면·판매채널·이력이 가리키는 R2 키를 모은다. 여기에 없는 객체는 어떤
 * 기능도 참조하지 않는 파일이므로 지워도 되는 후보다.
 */
export async function collectReferencedR2Keys() {
  const keys = new Set<string>();
  const add = (url: string | null | undefined) => {
    const key = r2KeyFromPublicUrl(url);
    if (key) keys.add(key);
  };
  const productRows = await prisma.$queryRaw<
    Array<{
      imageUrl: string | null;
      userFront: string | null;
      userBack: string | null;
      ebayImageUrls: string[] | null;
    }>
  >`SELECT "image_url" AS "imageUrl","user_front_image_url" AS "userFront",
      "user_back_image_url" AS "userBack","ebay_image_urls" AS "ebayImageUrls"
    FROM "products"`;
  for (const row of productRows) {
    add(row.imageUrl);
    add(row.userFront);
    add(row.userBack);
    for (const url of row.ebayImageUrls ?? []) add(url);
  }
  const simpleSources: Array<{ table: string; columns: string[] }> = [
    { table: "ai_image_jobs", columns: ["preview_url"] },
    { table: "image_work_assignments", columns: ["result_url"] },
    { table: "product_image_history", columns: ["image_url"] },
    { table: "variation_listing_states", columns: ["thumbnail_url"] },
    {
      table: "variation_thumbnail_settings",
      columns: ["logo_url", "background_url"],
    },
  ];
  for (const source of simpleSources) {
    for (const column of source.columns) {
      try {
        const rows = await prisma.$queryRawUnsafe<Array<{ url: string | null }>>(
          `SELECT "${column}" AS "url" FROM "${source.table}" WHERE "${column}" IS NOT NULL`,
        );
        for (const row of rows) add(row.url);
      } catch {
        // 아직 없는 표는 참조도 없다. 조사 때문에 표를 만들지 않는다.
      }
    }
  }
  // 등록 초안이 JSON으로 들고 있는 이미지 주소도 참조로 본다.
  try {
    const draftRows = await prisma.$queryRaw<Array<{ url: string | null }>>`
      SELECT jsonb_array_elements_text(
        CASE WHEN jsonb_typeof("image_urls_json"::jsonb)='array'
          THEN "image_urls_json"::jsonb ELSE '[]'::jsonb END
      ) AS "url" FROM "listing_drafts"`;
    for (const row of draftRows) add(row.url);
  } catch {
    // 표나 형식이 다르면 참조로 세지 않는다.
  }
  // 이력에 남은 과거 이미지도 아직 가리키는 기록이 있으므로 지움 후보로 보지 않는다.
  try {
    const historyRows = await prisma.$queryRaw<Array<{ url: string | null }>>`
      SELECT jsonb_array_elements_text(
        CASE WHEN jsonb_typeof("previous_urls")='array'
          THEN "previous_urls" ELSE '[]'::jsonb END
      ) AS "url" FROM "product_image_history"`;
    for (const row of historyRows) add(row.url);
  } catch {
    // 이력 표가 없으면 참조도 없다.
  }
  return keys;
}

/**
 * 버킷을 cursor로 이어 읽으며 용도별 사용량과 참조되지 않는 파일을 센다.
 * 읽기만 하며 어떤 객체도 지우지 않는다.
 */
export async function buildR2UsageReport({
  cursor,
  budgetMs,
}: {
  cursor?: string | null;
  budgetMs: number;
}): Promise<R2UsageReport> {
  const referenced = await collectReferencedR2Keys();
  const groups = new Map<string, R2UsageGroup>();
  const started = Date.now();
  let nextCursor = cursor ?? null;
  let scanned = 0;
  let bytes = 0;
  let unusedCount = 0;
  let unusedBytes = 0;
  do {
    const page = await listObjectsFromR2(nextCursor);
    for (const object of page.objects) {
      const name = r2UsageGroupOf(object.key);
      const group = groups.get(name) ?? {
        group: name,
        objectCount: 0,
        bytes: 0,
        unusedCount: 0,
        unusedBytes: 0,
        unusedOlderThan90dCount: 0,
        unusedOlderThan90dBytes: 0,
        unusedOlderThan30dCount: 0,
        unusedOlderThan30dBytes: 0,
        newestUnusedAt: null,
      };
      group.objectCount += 1;
      group.bytes += object.size;
      scanned += 1;
      bytes += object.size;
      if (!referenced.has(object.key)) {
        group.unusedCount += 1;
        group.unusedBytes += object.size;
        unusedCount += 1;
        unusedBytes += object.size;
        const age = object.lastModified
          ? started - object.lastModified.getTime()
          : 0;
        if (age >= 90 * DAY_MS) {
          group.unusedOlderThan90dCount += 1;
          group.unusedOlderThan90dBytes += object.size;
        }
        if (age >= 30 * DAY_MS) {
          group.unusedOlderThan30dCount += 1;
          group.unusedOlderThan30dBytes += object.size;
        }
        const modified = object.lastModified?.toISOString() ?? null;
        if (modified && (!group.newestUnusedAt || modified > group.newestUnusedAt))
          group.newestUnusedAt = modified;
      }
      groups.set(name, group);
    }
    nextCursor = page.cursor;
  } while (nextCursor && Date.now() - started < budgetMs);
  return {
    scanned,
    bytes,
    unusedCount,
    unusedBytes,
    groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes),
    cursor: nextCursor,
    referencedKeys: referenced.size,
  };
}
