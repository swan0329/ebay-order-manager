import AdmZip from "adm-zip";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeEbayFeedXml } from "@/lib/ebay-feed-file";

const xml = "<?xml version=\"1.0\"?><BulkDataExchangeResponses />";

describe("eBay Feed 결과 파일", () => {
  it("일반 XML을 읽는다", () => {
    expect(decodeEbayFeedXml(Buffer.from(xml))).toBe(xml);
  });

  it("GZIP XML을 압축 해제한다", () => {
    expect(decodeEbayFeedXml(gzipSync(xml))).toBe(xml);
  });

  it("ZIP 안의 XML을 압축 해제한다", () => {
    const archive = new AdmZip();
    archive.addFile("result.xml", Buffer.from(xml));
    expect(decodeEbayFeedXml(archive.toBuffer())).toBe(xml);
  });
});
