// Shopify OAuth 코드 → Admin API access token 교환 (로컬 실행용, 1회성)
//
// 사용법:
//   1) 브라우저에서 아래 authorize 주소를 연다 (스크립트가 출력해 줌)
//   2) 승인 후 example.com 으로 튕기면, 주소창 URL 전체를 복사
//   3) 곧바로 실행:
//        node scripts/shopify-exchange-token.mjs "붙여넣은_URL_전체"
//
// 코드는 몇 분이면 만료되므로, 복사하자마자 바로 실행하세요.

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const SCOPES =
  "write_products,read_products,write_inventory,read_inventory,read_orders,write_orders";
const REDIRECT_URI = "https://example.com";
const FALLBACK_SHOP = process.env.SHOPIFY_STORE_DOMAIN;

if (!CLIENT_ID || !CLIENT_SECRET || !FALLBACK_SHOP) {
  throw new Error(
    "SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, and SHOPIFY_STORE_DOMAIN are required.",
  );
}

const input = process.argv[2];

if (!input) {
  // 인자가 없으면 authorize 주소를 안내만 한다.
  const authorizeUrl =
    `https://${FALLBACK_SHOP}/admin/oauth/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=kpop123`;
  console.log("\n[1단계] 아래 주소를 브라우저에서 열고 승인하세요:\n");
  console.log(authorizeUrl);
  console.log(
    "\n[2단계] example.com 으로 튕기면 주소창 URL 전체를 복사한 뒤, 곧바로:\n",
  );
  console.log('   node scripts/shopify-exchange-token.mjs "복사한_URL"\n');
  process.exit(0);
}

function parseInput(value) {
  // 전체 URL을 붙였으면 code/shop을 파싱, 아니면 code 문자열로 간주.
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code"),
      shop: url.searchParams.get("shop") || FALLBACK_SHOP,
    };
  } catch {
    return { code: value.trim(), shop: FALLBACK_SHOP };
  }
}

const { code, shop } = parseInput(input);

if (!code) {
  console.error("❌ URL에서 code 를 찾지 못했습니다. ?code=... 가 포함된 URL을 붙여넣으세요.");
  process.exit(1);
}

console.log(`\nshop: ${shop}`);
console.log(`code: ${code.slice(0, 6)}…\n교환 중...\n`);

const exchangeRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
  }),
});

const exchangeText = await exchangeRes.text();
let token;
try {
  token = JSON.parse(exchangeText).access_token;
} catch {
  // ignore
}

if (!exchangeRes.ok || !token) {
  console.error(`❌ 교환 실패 (HTTP ${exchangeRes.status})`);
  console.error(exchangeText.slice(0, 500));
  console.error(
    "\n→ 보통 코드 만료입니다. authorize 주소를 다시 열어 새 코드를 받고 즉시 다시 실행하세요.",
  );
  process.exit(1);
}

console.log("✅ 토큰 발급 성공! 이제 Admin API 로 검증합니다...\n");

const verifyRes = await fetch(
  `https://${shop}/admin/api/${API_VERSION}/shop.json`,
  { headers: { "X-Shopify-Access-Token": token } },
);

if (!verifyRes.ok) {
  console.error(`⚠️ 토큰은 받았지만 Admin API 검증 실패 (HTTP ${verifyRes.status})`);
  console.error((await verifyRes.text()).slice(0, 300));
  console.log("\n토큰(검증 실패):", token);
  process.exit(1);
}

const shopInfo = JSON.parse(await verifyRes.text()).shop;
console.log(`✅ Admin API 동작 확인! 스토어: ${shopInfo?.name} (${shopInfo?.domain})\n`);
console.log("──────────────────────────────────────────");
console.log("아래 두 줄을 .env 와 Vercel 환경변수에 넣으세요:\n");
console.log(`SHOPIFY_STORE_DOMAIN=${shop}`);
console.log(`SHOPIFY_ADMIN_ACCESS_TOKEN=${token}`);
console.log("──────────────────────────────────────────\n");
