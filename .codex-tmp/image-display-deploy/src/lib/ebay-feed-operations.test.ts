import { describe, expect, it } from "vitest";
import { buildEbayFeedXml, parseEbayFeedResult } from "@/lib/ebay-feed-xml";

const targets = [
  { productId: "p1", sku: "SKU&1", productName: "Card 1", itemId: "1001", price: "12.30", quantity: 2 },
  { productId: "p2", sku: "SKU2", productName: "Card 2", itemId: "1002", price: "9.90", quantity: 1 },
];

describe("eBay Feed 자동 작업", () => {
  it("가격·수량 변경 XML을 안전하게 만든다", () => {
    const result = buildEbayFeedXml("revise", targets);
    expect(result).toContain("<ReviseInventoryStatusRequest");
    expect(result).toContain("<SKU>SKU&amp;1</SKU>");
    expect(result).toContain("<Version>1355</Version>");
    expect(result).toContain("<MessageID>p1</MessageID>");
    expect(result).toContain("<MessageID>p2</MessageID>");
    expect(result).toContain('<StartPrice currencyID="USD">12.30</StartPrice>');
  });

  it("판매중단 XML에는 명시적인 종료 사유를 넣는다", () => {
    const result = buildEbayFeedXml("end", targets);
    expect(result).toContain("<EndFixedPriceItemRequest");
    expect(result).toContain("<EndingReason>NotAvailable</EndingReason>");
    expect(result).toContain("<MessageID>p1</MessageID>");
  });

  it("ItemID로 관리하는 단품은 내부 SKU를 보내지 않는다 (운영 SKU Mismatch 회귀)", () => {
    const result = buildEbayFeedXml("revise", [{ ...targets[0], useSku: false }]);
    expect(result).toContain("<ItemID>1001</ItemID>");
    expect(result).toContain("<MessageID>p1</MessageID>");
    expect(result).not.toContain("<SKU>");
    expect(result).toContain('<StartPrice currencyID="USD">12.30</StartPrice>');
  });

  it("옵션 수량 0 반영은 공통 ItemID와 옵션 SKU를 함께 보낸다", () => {
    const result = buildEbayFeedXml("revise", [{ ...targets[0], useSku: true, quantity: 0 }]);
    expect(result).toContain("<ItemID>1001</ItemID><SKU>SKU&amp;1</SKU>");
    expect(result).toContain("<Quantity>0</Quantity>");
  });

  it("성공과 실패 응답을 상품에 연결한다", () => {
    const result = parseEbayFeedResult(`
      <BulkDataExchangeResponses>
        <ReviseInventoryStatusResponse><Ack>Success</Ack><InventoryStatus><ItemID>1001</ItemID><SKU>SKU&amp;1</SKU></InventoryStatus></ReviseInventoryStatusResponse>
        <ReviseInventoryStatusResponse><Ack>Failure</Ack><InventoryStatus><ItemID>1002</ItemID><SKU>SKU2</SKU></InventoryStatus><Errors><ShortMessage>Invalid quantity</ShortMessage></Errors></ReviseInventoryStatusResponse>
      </BulkDataExchangeResponses>
    `, targets);
    expect([...result.succeeded]).toEqual(["p1"]);
    expect(result.failures).toEqual([
      expect.objectContaining({ productId: "p2", sku: "SKU2", message: "Invalid quantity" }),
    ]);
  });

  it("같은 부모 Item ID의 옵션 결과를 SKU별 상품에 연결한다", () => {
    const variationTargets = [
      { productId: "p1", sku: "CARD-A", productName: "A", itemId: "shared" },
      { productId: "p2", sku: "CARD-B", productName: "B", itemId: "shared" },
    ];
    const result = parseEbayFeedResult(`
      <BulkDataExchangeResponses>
        <ReviseInventoryStatusResponse><Ack>Success</Ack><InventoryStatus><ItemID>shared</ItemID><SKU>CARD-A</SKU></InventoryStatus></ReviseInventoryStatusResponse>
        <ReviseInventoryStatusResponse><Ack>Failure</Ack><InventoryStatus><ItemID>shared</ItemID><SKU>CARD-B</SKU></InventoryStatus><Errors><ShortMessage>Invalid quantity</ShortMessage></Errors></ReviseInventoryStatusResponse>
      </BulkDataExchangeResponses>
    `, variationTargets);
    expect([...result.succeeded]).toEqual(["p1"]);
    expect(result.failures[0]).toMatchObject({ productId: "p2", sku: "CARD-B" });
  });

  it("네임스페이스가 붙은 eBay 응답도 읽는다", () => {
    const result = parseEbayFeedResult(`
      <ns:BulkDataExchangeResponses xmlns:ns="urn:ebay:apis:eBLBaseComponents">
        <ns:ReviseInventoryStatusResponse><ns:Ack>Success</ns:Ack><ns:InventoryStatus><ns:ItemID>1001</ns:ItemID><ns:SKU>SKU&amp;1</ns:SKU></ns:InventoryStatus></ns:ReviseInventoryStatusResponse>
      </ns:BulkDataExchangeResponses>
    `, targets);
    expect([...result.succeeded]).toEqual(["p1"]);
    expect(result.responseCount).toBe(1);
  });

  it("옵션 품절 수량만 바꿀 때 빈 가격 태그를 보내지 않는다", () => {
    const result = buildEbayFeedXml("revise", [
      { productId: "p1", sku: "CARD-A", productName: "A", itemId: "shared", quantity: 0 },
    ]);
    expect(result).toContain("<Quantity>0</Quantity>");
    expect(result).not.toContain("<StartPrice");
  });

  it("상품번호·SKU 없는 실패도 CorrelationID로 연결하며 응답 순서에 의존하지 않는다", () => {
    const result = parseEbayFeedResult(`
      <ReviseInventoryStatusResponse><CorrelationID>p2</CorrelationID><Ack>Failure</Ack><Errors><LongMessage>Inventory API listing cannot be revised</LongMessage></Errors></ReviseInventoryStatusResponse>
      <ReviseInventoryStatusResponse><CorrelationID>p1</CorrelationID><Ack>Warning</Ack></ReviseInventoryStatusResponse>
    `, targets);
    expect([...result.succeeded]).toEqual(["p1"]);
    expect(result.failures).toEqual([expect.objectContaining({ productId: "p2", message: "Inventory API listing cannot be revised" })]);
    expect(result.unmatchedErrors).toEqual([]);
  });

  it("판매중단 실패의 네임스페이스 CorrelationID를 읽는다", () => {
    const result = parseEbayFeedResult(`<e:EndFixedPriceItemResponse><e:CorrelationID>p1</e:CorrelationID><e:Ack>Failure</e:Ack><e:Errors><e:LongMessage>Cannot end listing</e:LongMessage></e:Errors></e:EndFixedPriceItemResponse>`, targets);
    expect(result.failures[0]).toMatchObject({ productId: "p1", message: "Cannot end listing" });
  });

  it("SKU 없는 공통 ItemID 응답을 임의의 옵션에 연결하지 않는다", () => {
    const variations = targets.map((target) => ({ ...target, itemId: "shared" }));
    const result = parseEbayFeedResult(`<ReviseInventoryStatusResponse><Ack>Success</Ack><InventoryStatus><ItemID>shared</ItemID></InventoryStatus></ReviseInventoryStatusResponse>`, variations);
    expect(result.succeeded.size).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it("CorrelationID는 같은 상품번호를 공유하는 옵션도 구분한다", () => {
    const variations = targets.map((target) => ({ ...target, itemId: "shared" }));
    const result = parseEbayFeedResult(`<ReviseInventoryStatusResponse><CorrelationID>p1</CorrelationID><Ack>Success</Ack><InventoryStatus><ItemID>shared</ItemID></InventoryStatus></ReviseInventoryStatusResponse>`, variations);
    expect([...result.succeeded]).toEqual(["p1"]);
  });

  it("잘못된 식별자 조합이나 모르는 CorrelationID를 다른 상품에 연결하지 않는다", () => {
    for (const identity of ["<CorrelationID>unknown</CorrelationID><ItemID>1001</ItemID>", "<ItemID>1001</ItemID><SKU>SKU2</SKU>"]) {
      const result = parseEbayFeedResult(`<ReviseInventoryStatusResponse><Ack>Success</Ack>${identity}</ReviseInventoryStatusResponse>`, targets);
      expect(result.succeeded.size).toBe(0);
    }
  });

  it("이전 작업의 식별자 없는 오류 사유를 보존한다", () => {
    const result = parseEbayFeedResult(`<ReviseInventoryStatusResponse><Ack>Failure</Ack><Errors><LongMessage>Invalid price &amp; quantity</LongMessage></Errors></ReviseInventoryStatusResponse>`, targets);
    expect(result.failures).toEqual([]);
    expect(result.unmatchedErrors).toEqual(["Invalid price & quantity"]);
  });

  it("중복 응답을 한 번만 세고 모순된 결과는 실패로 남긴다", () => {
    for (const acks of [["Failure", "Failure", "Success"], ["Success", "Failure", "Failure"]]) {
      const result = parseEbayFeedResult(acks.map((ack) => `<ReviseInventoryStatusResponse><CorrelationID>p1</CorrelationID><Ack>${ack}</Ack></ReviseInventoryStatusResponse>`).join(""), targets);
      expect(result.succeeded.size).toBe(0);
      expect(result.failures).toHaveLength(1);
    }
  });
});
