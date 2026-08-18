import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function unquote(value: string) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);

    if (!match || line.trimStart().startsWith("#")) {
      continue;
    }

    process.env[match[1]] ??= unquote(match[2]);
  }
}

loadEnv();

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error("사용법: npm run products:import -- <xlsx|xls|csv 파일경로>");
  }

  const absolutePath = path.resolve(process.cwd(), filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`파일을 찾을 수 없습니다: ${absolutePath}`);
  }

  const { importProductsCsv, importProductsExcel } = await import(
    "../src/lib/products"
  );
  const extension = path.extname(absolutePath).toLowerCase();
  const result =
    extension === ".xlsx" || extension === ".xls"
      ? await importProductsExcel(readFileSync(absolutePath), "script")
      : await importProductsCsv(readFileSync(absolutePath, "utf8"), "script");

  console.log(
    `상품 등록 ${result.created}건, 수정 ${result.updated}건, 오류 ${result.errors.length}건, 같은 카드라 건너뜀 ${result.duplicateCards.length}건`,
  );

  // 같은 카드가 SKU만 다른 줄로 또 들어오면 상품이 쪼개지고 재고가 흩어진다.
  // 만들지 않고 어떤 줄이 어디에 걸렸는지 그대로 보여 준다.
  if (result.duplicateCards.length) {
    console.log("\n이미 같은 카드가 있어 새로 만들지 않은 줄:");
    for (const skip of result.duplicateCards.slice(0, 20)) {
      console.log(`  ${skip.sku} → 기존 ${skip.existingSku} · ${skip.productName}`);
    }
    if (result.duplicateCards.length > 20) {
      console.log(`  … 외 ${result.duplicateCards.length - 20}건`);
    }
  }

  if (result.errors.length) {
    console.log(result.errors.slice(0, 20).join("\n"));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
