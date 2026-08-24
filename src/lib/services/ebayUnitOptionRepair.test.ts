import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseEbayUnitItem } from "@/lib/services/ebayUnitOptionRepair";

describe("parseEbayUnitItem", () => {
  it("reads attributed prices and accepts zero quantity from a real Trading API shape", () => {
    const parsed = parseEbayUnitItem(`<eBay:GetItemResponse><eBay:Item><eBay:Variations><eBay:Variation><eBay:SKU>40776</eBay:SKU><eBay:StartPrice currencyID="USD">8.40</eBay:StartPrice><eBay:Quantity>0</eBay:Quantity><eBay:VariationSpecifics><eBay:NameValueList><eBay:Name>Card</eBay:Name><eBay:Value>유닛</eBay:Value></eBay:NameValueList></eBay:VariationSpecifics><eBay:SellingStatus><eBay:QuantitySold>0</eBay:QuantitySold></eBay:SellingStatus></eBay:Variation></eBay:Variations></eBay:Item></eBay:GetItemResponse>`);
    expect(parsed.variations).toEqual([{ sku: "40776", price: "8.40", quantity: "0", quantitySold: 0, specifics: [{ name: "Card", value: "유닛" }] }]);
  });
});
