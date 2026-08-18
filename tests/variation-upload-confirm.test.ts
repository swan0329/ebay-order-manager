import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { endedItemIdsFrom, parseEbayUploadResult } = await import(
  "@/lib/variation-upload-confirm"
);

function csvBuffer(lines: string[]) {
  return Buffer.from(lines.join("\r\n"), "utf8");
}

describe("eBay 업로드 결과 파일 읽기", () => {
  it("새로 만들어진 옵션상품의 Item number를 SKU로 찾는다", () => {
    const rows = parseEbayUploadResult(
      csvBuffer([
        "Bulk Listing Tool Report",
        "Action,Item number,Custom label (SKU),Status,Error message",
        "Add,286123456789,VAR-ABC123,Success,",
        "End,285000000001,123456,Success,",
      ]),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ itemId: "286123456789", sku: "VAR-ABC123", succeeded: true });
    expect(rows[1]).toMatchObject({ itemId: "285000000001", sku: "123456", succeeded: true });
  });

  it("실패한 행은 상품번호가 없어도 읽고 실패로 표시한다", () => {
    // 등록이 거부되면 eBay는 Item number 없이 오류만 돌려준다. 이 행을 버리면
    // 사람이 실패 사실을 모른 채 다음 단계로 넘어간다.
    const rows = parseEbayUploadResult(
      csvBuffer([
        "Action,Item number,Custom label (SKU),Status,Error message",
        "Add,,VAR-ABC123,Failure,21919067: Invalid picture URL",
      ]),
    );

    expect(rows).toEqual([
      {
        action: "Add",
        itemId: null,
        sku: "VAR-ABC123",
        succeeded: false,
        message: "21919067: Invalid picture URL",
      },
    ]);
  });

  it("오류 열이 비어 있으면 성공으로 본다", () => {
    const rows = parseEbayUploadResult(
      csvBuffer(["Item number,Custom label,Error code", "286123456789,VAR-ABC123,0"]),
    );

    expect(rows[0].succeeded).toBe(true);
  });

  it("상품번호도 SKU도 없는 파일은 거절한다", () => {
    expect(() =>
      parseEbayUploadResult(csvBuffer(["Title,Price", "Stray Kids Photocard,9.99"])),
    ).toThrow(/Item number/);
  });
});

describe("판매 종료로 바꿀 상품번호 고르기", () => {
  it("eBay가 End를 성공으로 처리한 행만 고른다", () => {
    const rows = parseEbayUploadResult(
      csvBuffer([
        "Action,Item number,Custom label (SKU),Status,Error message",
        "Revise,286123456789,VAR-ABC123,Success,",
        "End,285000000001,123456,Success,",
        "End,285000000002,123457,Failure,21916884: Item not found",
      ]),
    );

    // 옵션상품(Revise)은 살아 있어야 하고, 실패한 종료는 다음에 다시 시도해야 한다.
    expect(endedItemIdsFrom(rows)).toEqual(["285000000001"]);
  });

  it("작업 열이 없으면 아무것도 종료하지 않는다", () => {
    const rows = parseEbayUploadResult(
      csvBuffer(["Item number,Custom label", "285000000001,123456"]),
    );

    expect(endedItemIdsFrom(rows)).toEqual([]);
  });
});
