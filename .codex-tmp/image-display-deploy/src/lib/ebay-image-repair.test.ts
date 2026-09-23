import { expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { imageOnlyRevision } from "./ebay-image-repair";
import { XMLParser } from "fast-xml-parser";
it("revises only parent and all option pictures, preserving labels and escaping XML",()=>{
  const payload=imageOnlyRevision('123',['https://test/cover.jpg'],[{name:'Card',value:'Jin & V',urls:['https://test/card.jpg?a=1&b=2']}]);
  const item=new XMLParser().parse(payload).Item;
  expect(Object.keys(item).sort()).toEqual(['ItemID','PictureDetails','Variations']);
  expect(Object.keys(item.Variations)).toEqual(['Pictures']);
  expect(item.Variations.Pictures.VariationSpecificPictureSet.VariationSpecificValue).toBe('Jin & V');
  expect(item.Variations.Pictures.VariationSpecificPictureSet.PictureURL).toBe('https://test/card.jpg?a=1&b=2');
  expect(payload).not.toMatch(/<(?:Quantity|StartPrice|SKU|Variation|ListingStatus)>/);
});
it("rejects inconsistent option picture names",()=>{
  expect(()=>imageOnlyRevision('123',[],[{name:'Card',value:'Jin',urls:[]},{name:'Member',value:'V',urls:[]}])).toThrow();
});
