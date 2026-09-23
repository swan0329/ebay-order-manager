from pathlib import Path
p=Path('src/lib/shopify-orders.ts');s=p.read_text();s=s.replace('  fulfillments?: {\n    nodes?: Array<{','  fulfillments?: Array<{').replace('    }>;\n  } | null;\n};','    }> | null;\n};',1)
s=s.replace('errors?: Array<{ message?: string }>','errors?: Array<{ message?: string; extensions?: { code?: string } }>')
s=s.replace('  throw new ShopifyApiError(\n    "Shopify 주문 GraphQL 조회에 실패했습니다. 앱의 read_orders 권한을 확인해 주세요.",', '''  const denied = response.errors.some(error => error.extensions?.code === "ACCESS_DENIED" || /access denied|read_orders/i.test(error.message ?? ""));
  const throttled = response.errors.some(error => error.extensions?.code === "THROTTLED");
  throw new ShopifyApiError(
    denied ? "Shopify 주문 접근이 거부됐습니다. read_orders 및 주문 고객정보 접근 승인을 확인해 주세요."
      : throttled ? "Shopify 주문 조회 요청량이 제한되었습니다. 잠시 후 다시 불러와 주세요."
      : "Shopify 주문 조회 형식 또는 API 응답에 오류가 있습니다. 주문 연동 점검이 필요합니다.",''')
s=s.replace('    nodes { id status createdAt trackingInfo { company number } }','    id status createdAt trackingInfo { company number }')
p.write_text(s)
p=Path('src/lib/orders.ts');s=p.read_text();s=s.replace('(rawOrder.fulfillments?.nodes ?? [])','(rawOrder.fulfillments ?? [])');p.write_text(s)
p=Path('scripts/pocamarket-bridge.mjs');s=p.read_text();s=s.replace('encoding: "utf8", timeout: 20000','encoding: "utf8", timeout: 20000, windowsHide: true').replace('encoding: "buffer", timeout: 20000','encoding: "buffer", timeout: 20000, windowsHide: true')
s=s.replace('  await waitForText(serial, "포토카드를 구매했어요", 15 * 60 * 1000);','  // 완료 수량은 주문 화면의 명시적인 1장 결제 완료 확인만 증가시킨다.')
a=s.index('async function processJob(');b=s.index('\nconst randomDelay',a)
s=s[:a]+'''async function processJob(serial, job) {
  const purchased = Number(job.purchasedQuantity ?? 0);
  if (!Number.isInteger(purchased) || purchased < 0 || purchased >= job.requestedQuantity) return;
  // 한 장씩 결제 확인 화면까지만 준비한다. 다음 장은 사람의 완료 확인 후 queued로 돌아온다.
  await purchaseOne(serial, job, purchased);
}
'''+s[b:]
s=s.replace('  const serial = deviceSerial();','  let serial = deviceSerial();')
s=s.replace('    let job = null;\n    try {','''    let job = null;
    try {
      if (!connectedDevices().includes(serial)) serial = deviceSerial();
    } catch {
      console.error("휴대전화 연결 대기 중입니다. 무선 디버깅을 켜고 연결 도우미에서 다시 연결해 주세요.");
      await wait(5000);
      continue;
    }
    try {''')
p.write_text(s)
p=Path('src/app/api/pocamarket-bridge/jobs/route.ts');s=p.read_text();s=s.replace('id: string; productNumber: string; requestedQuantity: number;','id: string; productNumber: string; requestedQuantity: number; purchasedQuantity: number;');s=s.replace('WHERE ("status" = \'running\' AND "device_serial" = ${deviceSerial})\n         OR "status" = \'queued\'','WHERE "status" = \'queued\'');s=s.replace('j."reference_unit_price"::text AS "referenceUnitPrice",','j."purchased_quantity" AS "purchasedQuantity", j."reference_unit_price"::text AS "referenceUnitPrice",');p.write_text(s)
