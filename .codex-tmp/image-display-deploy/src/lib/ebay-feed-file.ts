import AdmZip from "adm-zip";
import { gunzipSync } from "node:zlib";

/** Decode an eBay Feed result, which can be plain XML, ZIP, or GZIP. */
export function decodeEbayFeedXml(buffer: Buffer) {
  const magic = buffer.subarray(0, 2).toString("hex");
  if (magic === "1f8b") return gunzipSync(buffer).toString("utf8");
  if (magic !== "504b") return buffer.toString("utf8");

  const archive = new AdmZip(buffer);
  const entries = archive.getEntries();
  const entry = entries.find((candidate) =>
    !candidate.isDirectory && candidate.entryName.toLowerCase().endsWith(".xml"),
  ) ?? entries.find((candidate) => !candidate.isDirectory);
  if (!entry) throw new Error("eBay 결과 압축 파일이 비어 있습니다.");
  return entry.getData().toString("utf8");
}
