import "server-only";

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

export type ProductOperationalView =
  | "sellable"
  | "selling"
  | "listable"
  | "own_photo_listable"
  | "unit_no_members"
  | "price_missing"
  | "image_pending"
  | "in_stock"
  | "procurement_ready"
  | "procurement_listable"
  | "stop_required"
  | "sold_out"
  | "review";

// 이미지 완료 판정은 "최종 이미지가 상품에 실제 적용된 상태"만 인정한다.
// image_source는 촬영본 연결(r2_user_uploaded)·AI 최종 업로드(approveAiJob)·
// Lens 검수 승인 시점에만 pocamarket에서 바뀌므로, 이 값이 판정 기준이 된다.
// AI가 pass_ready(통과)여도 "최종 업로드" 전이면 상품 이미지가 원본 그대로이므로
// 완료로 세지 않는다(그래야 판매가능 썸네일과 실제 이미지가 항상 일치한다).

// 좁은 이미지 완료: 촬영본 + AI 최종 업로드. Lens 워커 검수 승인분은 제외한다
// (신규등록 엑셀은 일반 경로만, Lens 승인분은 별도 버튼으로 유지).
const imageReadyGeneralSql = `(
  COALESCE("user_front_image_url", '') <> ''
  OR (
    "image_source" = 'lens_workbench'
    AND NOT EXISTS (
      SELECT 1 FROM "image_work_assignments" a
      WHERE a."product_id"="products"."id" AND a."status"='approved'
    )
  )
)`;

// 넓은 이미지 완료: 위 조건 + Lens 워커 검수 승인 이미지.
// 재고관리 카드(판매중/판매 가능/이미지 작업 필요 등)는 Lens 승인분도 완료로 센다.
export const imageReadySql = `(
  COALESCE("user_front_image_url", '') <> ''
  OR "image_source" IN ('r2_user_uploaded','lens_workbench')
)`;

// eBay 등록됨(판매중) 여부. 신규등록 엑셀의 "미등록" 판정과 정확히 반대가 되도록 맞춘다.
export const registeredSql = `(
  COALESCE("ebay_item_id", '') <> ''
  AND UPPER(COALESCE("listing_status", 'ACTIVE')) NOT IN ('ENDED','INACTIVE','FAILED')
)`;

// 가격 없음: 포카마켓 표시가(sale_price)도, 사람이 넣은 eBay 판매가(ebay_price)도 없다.
// 이 상태면 신규등록 파일을 만들 때 조용히 제외되므로 별도 작업 대상으로 센다.
export const priceMissingSql = `(
  COALESCE("sale_price", 0) <= 0 AND COALESCE("ebay_price", 0) <= 0
)`;

const imageReadyGeneral = Prisma.raw(imageReadyGeneralSql);
const imageReady = Prisma.raw(imageReadySql);
const isRegistered = Prisma.raw(registeredSql);
const priceMissing = Prisma.raw(priceMissingSql);

function condition(view: ProductOperationalView) {
  switch (view) {
    case "sellable":
      // 신규등록 엑셀 대상과 동일하게 유지: 좁은 판정(Lens 승인 제외).
      return Prisma.sql`(
        "stock_quantity" > 0 OR COALESCE("pocamarket_available_count", 0) > 0
      ) AND ${imageReadyGeneral}`;
    case "selling":
      // 판매중: 판매가능 조건 + eBay 등록됨
      return Prisma.sql`(
        "stock_quantity" > 0 OR COALESCE("pocamarket_available_count", 0) > 0
      ) AND ${imageReady} AND ${isRegistered}`;
    case "listable":
      // 판매 가능(올릴 수 있음): 판매가능 조건 + 아직 미등록
      return Prisma.sql`(
        "stock_quantity" > 0 OR COALESCE("pocamarket_available_count", 0) > 0
      ) AND ${imageReady} AND NOT ${isRegistered}`;
    case "own_photo_listable":
      // 직접촬영(촬영본 연결) + 내 재고 보유 + 미등록. AI·Lens 이미지는 제외한다.
      return Prisma.sql`
        "stock_quantity" > 0
        AND COALESCE("user_front_image_url", '') <> ''
        AND NOT ${isRegistered}`;
    case "unit_no_members":
      // 판매 가능(미등록) 유닛 카드인데 포함 멤버(featured_members)가 아직 비어 있는 것.
      // 유닛 여부는 앱 전체 기준과 동일하게 option_name='unit'으로 판별한다.
      return Prisma.sql`(
        "stock_quantity" > 0 OR COALESCE("pocamarket_available_count", 0) > 0
      ) AND ${imageReady} AND NOT ${isRegistered}
        AND LOWER(TRIM(COALESCE("option_name", ''))) = 'unit'
        AND COALESCE("featured_members", '') = ''`;
    case "price_missing":
      // 판매 가능(공급·이미지 완료·미등록)인데 가격이 없는 상품.
      // 판매 가능 카드와 같은 기준을 쓰므로 여기서 가격을 넣으면 바로 등록 대상이 된다.
      return Prisma.sql`(
        "stock_quantity" > 0 OR COALESCE("pocamarket_available_count", 0) > 0
      ) AND ${imageReady} AND NOT ${isRegistered} AND ${priceMissing}`;
    case "image_pending":
      return Prisma.sql`(
        "stock_quantity" > 0 OR COALESCE("pocamarket_available_count", 0) > 0
      ) AND NOT ${imageReady}`;
    case "in_stock":
      return Prisma.sql`"stock_quantity" > 0 AND ${imageReady}`;
    case "procurement_ready":
      return Prisma.sql`
        "stock_quantity" <= 0
        AND COALESCE("pocamarket_available_count", 0) > 0
        AND ${imageReady}
      `;
    case "procurement_listable":
      // 포카 조달판매 중 아직 eBay에 안 올린 것. "판매 가능"에서 내 재고분을 뺀
      // 나머지이며, 실제로 지금 올릴 수 있는 조달 대상이다.
      return Prisma.sql`
        "stock_quantity" <= 0
        AND COALESCE("pocamarket_available_count", 0) > 0
        AND ${imageReady}
        AND NOT ${isRegistered}
      `;
    case "stop_required":
      return Prisma.sql`
        "stock_quantity" <= 0
        AND "pocamarket_synced_at" IS NOT NULL
        AND "pocamarket_available_count" = 0
        AND COALESCE("ebay_item_id", '') <> ''
        AND UPPER(COALESCE("listing_status", 'ACTIVE')) IN ('ACTIVE','PUBLISHED','LISTED')
      `;
    case "sold_out":
      // 품절: 내 재고 없음 + 포카 조달 불가. 단 eBay에 아직 활성 등록된 것은
      // "판매중단 필요"가 담당하므로 여기서는 제외해 두 숫자가 겹치지 않게 한다.
      return Prisma.sql`
        "stock_quantity" <= 0
        AND "pocamarket_synced_at" IS NOT NULL
        AND "pocamarket_available_count" = 0
        AND NOT (
          COALESCE("ebay_item_id", '') <> ''
          AND UPPER(COALESCE("listing_status", 'ACTIVE')) IN ('ACTIVE','PUBLISHED','LISTED')
        )
      `;
    case "review":
      return Prisma.sql`"pocamarket_synced_at" IS NULL`;
  }
}

export async function getOperationalProductIds(view: ProductOperationalView) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "products" WHERE ${condition(view)}
  `;
  return rows.map((row) => row.id);
}
