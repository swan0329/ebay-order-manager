import { jsonError } from "@/lib/http";

export async function POST() {
  return jsonError(
    "eBay API 직접 업로드는 비활성화되었습니다. eBay Excel 파일을 사용하세요.",
    410,
  );
}
