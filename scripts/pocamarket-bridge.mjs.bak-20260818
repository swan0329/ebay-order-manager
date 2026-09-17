import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const configPath = process.env.POCAMARKET_BRIDGE_CONFIG || path.join(root, "pocamarket-bridge.config.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const adb = process.env.ADB_PATH || path.join(root, "tools", "platform-tools", "adb.exe");
const apiBase = (process.env.POCAMARKET_API_BASE || "https://ebay-order-manager-lake.vercel.app").replace(/\/$/, "");
const token = process.env.POCAMARKET_BRIDGE_TOKEN;

function adbRun(...args) {
  return execFileSync(adb, args, { encoding: "utf8", timeout: 20000 }).trim();
}

function adbBuffer(...args) {
  return execFileSync(adb, args, { encoding: "buffer", timeout: 20000 });
}

function deviceSerial() {
  if (config.adbAddress) {
    try { adbRun("connect", config.adbAddress); } catch { /* Checked below. */ }
  }
  const devices = adbRun("devices").split(/\r?\n/).slice(1).map((line) => line.trim()).filter((line) => line.endsWith("\tdevice"));
  if (config.adbAddress) {
    const wireless = devices.find((line) => line.split(/\s+/)[0] === config.adbAddress);
    if (wireless) return config.adbAddress;
    throw new Error(`무선 Android 장치에 연결할 수 없습니다: ${config.adbAddress}`);
  }
  if (devices.length !== 1) throw new Error(`연결된 Android 장치는 정확히 1대여야 합니다. 현재 ${devices.length}대`);
  return devices[0].split(/\s+/)[0];
}

async function unlockSimpleKeyguard(serial) {
  adbRun("-s", serial, "shell", "input", "keyevent", "224");
  await wait(300);
  const state = adbRun("-s", serial, "shell", "dumpsys", "window");
  if (!/isKeyguardShowing=true/.test(state)) return;
  adbRun("-s", serial, "shell", "input", "swipe", "540", "2200", "540", "250", "800");
  await wait(800);
  const after = adbRun("-s", serial, "shell", "dumpsys", "window");
  if (/isKeyguardShowing=true/.test(after)) throw new Error("휴대폰 잠금을 직접 해제해 주세요.");
}

function dumpUi(serial) {
  adbRun("-s", serial, "shell", "uiautomator", "dump", "/sdcard/window.xml");
  return adbRun("-s", serial, "shell", "cat", "/sdcard/window.xml");
}

function visibleText(xml) {
  return [...xml.matchAll(/(?:text|content-desc|hint)="([^"]+)"/g)]
    .map((match) => match[1].replace(/&#10;/g, "\n").replace(/&amp;/g, "&").replace(/&quot;/g, '"'))
    .filter(Boolean).join("\n");
}

function centerFor(xml, matcher) {
  const nodes = [...xml.matchAll(/<node\s+([^>]+)>?/g)].map((match) => match[1]);
  const wanted = new RegExp(matcher, "i");
  for (const node of nodes) {
    const text = `${node.match(/text="([^"]*)"/)?.[1] ?? ""} ${node.match(/content-desc="([^"]*)"/)?.[1] ?? ""}`;
    const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (wanted.test(text) && bounds) return [Math.round((+bounds[1] + +bounds[3]) / 2), Math.round((+bounds[2] + +bounds[4]) / 2)];
  }
  return null;
}

function tapText(serial, matcher) {
  const point = centerFor(dumpUi(serial), matcher);
  if (!point) throw new Error(`화면에서 '${matcher}' 요소를 찾지 못했습니다.`);
  adbRun("-s", serial, "shell", "input", "tap", String(point[0]), String(point[1]));
}

function tapExactText(serial, wantedText) {
  const xml = dumpUi(serial);
  const nodes = [...xml.matchAll(/<node\s+([^>]+)>?/g)].map((match) => match[1]);
  for (const node of nodes) {
    const text = node.match(/text="([^"]*)"/)?.[1] ?? "";
    const description = node.match(/content-desc="([^"]*)"/)?.[1] ?? "";
    const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if ((text === wantedText || description === wantedText) && bounds) {
      adbRun("-s", serial, "shell", "input", "tap",
        String(Math.round((+bounds[1] + +bounds[3]) / 2)),
        String(Math.round((+bounds[2] + +bounds[4]) / 2)));
      return;
    }
  }
  throw new Error(`화면에서 정확히 '${wantedText}'인 요소를 찾지 못했습니다.`);
}

function tap(serial, x, y) {
  adbRun("-s", serial, "shell", "input", "tap", String(x), String(y));
}

async function waitForText(serial, matcher, timeoutMs = 15000) {
  const wanted = new RegExp(matcher, "i");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const xml = dumpUi(serial);
    if (wanted.test(visibleText(xml))) return xml;
    await wait(750);
  }
  throw new Error(`화면에서 '${matcher}' 상태를 기다리다 시간이 초과됐습니다.`);
}

async function checkboxStates(serial, boxes) {
  const png = adbBuffer("-s", serial, "exec-out", "screencap", "-p");
  const metadata = await sharp(png).metadata();
  return Promise.all(boxes.map(async (box) => {
    const centerX = Math.min((metadata.width ?? 1080) - 1, box.x2 - 35);
    const centerY = Math.min((metadata.height ?? 2400) - 1, box.y1 + 35);
    const { data, info } = await sharp(png)
      .extract({ left: centerX - 15, top: centerY - 15, width: 30, height: 30 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let brightness = 0;
    for (let index = 0; index < data.length; index += info.channels) {
      brightness += (data[index] + data[index + 1] + data[index + 2]) / 3;
    }
    return brightness / (data.length / info.channels) < 140;
  }));
}

async function tapPurchaseConfirmRows(serial, xml) {
  const rows = [...xml.matchAll(/<node\s+([^>]+clickable="true"[^>]*)>/g)]
    .map((match) => match[1].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/))
    .filter(Boolean)
    .map((bounds) => ({ x1: +bounds[1], y1: +bounds[2], x2: +bounds[3], y2: +bounds[4] }))
    .filter((box) => box.x2 - box.x1 > 900 && box.y2 - box.y1 >= 150 && box.y1 > 800 && box.y2 < 2150)
    .slice(0, 4);
  if (rows.length !== 4) throw new Error("구매 전 확인 항목 네 개를 찾지 못했습니다.");
  let selected = await checkboxStates(serial, rows);
  for (let index = 0; index < rows.length; index += 1) {
    if (selected[index]) continue;
    tap(serial, rows[index].x2 - 34, rows[index].y1 + 35);
    await wait(250);
  }
  // Never tap a checkbox twice. During its animation a selected checkbox can
  // briefly look unselected, and a retry would toggle it off again.
  await wait(1200);
  selected = await checkboxStates(serial, rows);
  if (selected.some((value) => !value)) throw new Error("구매 전 확인 항목 선택에 실패했습니다.");
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(url, options = {}) {
  const response = await fetch(`${apiBase}${url}`, { ...options, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `API ${response.status}`);
  return body;
}

async function update(jobId, body) {
  return api(`/api/pocamarket-bridge/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function purchaseOne(serial, job, purchasedQuantity) {
  await unlockSimpleKeyguard(serial);
  adbRun("-s", serial, "shell", "svc", "power", "stayon", "true");
  const detailUrl = config.detailUrlTemplate.replace("{productNumber}", job.productNumber);
  adbRun("-s", serial, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", detailUrl, config.packageName);
  await wait(1800);

  const xml = dumpUi(serial);
  const prices = [...visibleText(xml).matchAll(new RegExp(config.priceRegex, "g"))].map((match) => Number(String(match[1]).replace(/,/g, ""))).filter(Number.isFinite);
  if (!prices.length) throw new Error("판매 가격을 화면에서 읽지 못했습니다.");
  const foundUnitPrice = Math.min(...prices);
  if (foundUnitPrice > Number(job.maxUnitPrice)) {
    await update(job.id, { status: "failed", foundUnitPrice, errorMessage: "최대 허용가격 초과" });
    return;
  }
  tap(serial, config.quickBuyRowX, config.quickBuyRowY);
  await waitForText(serial, "최종 결제 금액", 10000);
  const checkout = dumpUi(serial);
  if (!/네이버페이 결제 수단 선택됨/.test(visibleText(checkout))) throw new Error("네이버페이가 선택되지 않았습니다.");
  tapText(serial, config.checkoutButtonText);
  const confirmSheet = await waitForText(serial, "구매 전 확인해 주세요", 10000);
  await tapPurchaseConfirmRows(serial, confirmSheet);
  await wait(500);
  tapExactText(serial, "확인했어요");

  await waitForText(serial, "머니/포인트 결제", 15000);
  tapText(serial, "카드 결제");
  await wait(400);
  tapText(serial, "다음");
  let paymentPage = await waitForText(serial, "네이버 앱으로 자동 로그인|네이버 현대카드 선택됨", 20000);
  if (/네이버 앱으로 자동 로그인/.test(visibleText(paymentPage))) {
    tapText(serial, "앱 열기");
    const loginApproval = await waitForText(serial, "로그인을 허락하시겠습니까", 15000);
    if (/로그인을 허락하시겠습니까/.test(visibleText(loginApproval))) tapText(serial, "예");
    paymentPage = await waitForText(serial, "네이버 현대카드 선택됨", 20000);
  }
  if (!/네이버 현대카드 선택됨/.test(visibleText(paymentPage))) throw new Error("네이버 현대카드가 선택되지 않았습니다.");
  tapText(serial, "동의하고 결제하기");
  await waitForText(serial, "비밀번호는 6자리|생체 인증", 15000);
  await update(job.id, { status: "awaiting_confirmation", foundUnitPrice, purchasedQuantity });
  console.log(`상품 ${job.productNumber} ${purchasedQuantity + 1}/${job.requestedQuantity} · 휴대폰에서 네이버페이 비밀번호를 입력하세요.`);
  await waitForText(serial, "포토카드를 구매했어요", 15 * 60 * 1000);
  return foundUnitPrice;
}

async function processJob(serial, job) {
  let purchased = 0;
  for (; purchased < job.requestedQuantity; purchased += 1) {
    const price = await purchaseOne(serial, job, purchased);
    const done = purchased + 1;
    await update(job.id, {
      status: done >= job.requestedQuantity ? "completed" : "running",
      foundUnitPrice: price,
      purchasedQuantity: done,
    });
    if (done < job.requestedQuantity) await wait(1000);
  }
}

const randomDelay = (minimum, maximum) =>
  Math.round(minimum + Math.random() * Math.max(0, maximum - minimum));

async function syncUpdate(serial, item, body) {
  return api("/api/pocamarket-bridge/sync", {
    method: "PATCH",
    body: JSON.stringify({ itemId: item.id, device: serial, ...body }),
  });
}

async function inspectCatalogItem(serial, item, speed) {
  await unlockSimpleKeyguard(serial);
  adbRun("-s", serial, "shell", "svc", "power", "stayon", "true");
  const detailUrl = config.detailUrlTemplate.replace("{productNumber}", item.productNumber);
  adbRun("-s", serial, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", detailUrl, config.packageName);
  await wait(Number(config.syncPageWaitMs ?? speed.pageWaitMs ?? 2200));
  const screenText = visibleText(dumpUi(serial));
  const safetyPattern = new RegExp(config.syncSafetyStopRegex ?? "captcha|자동.{0,5}접근|비정상.{0,5}접근|로그인.{0,5}(필요|만료)|본인.{0,5}인증", "i");
  if (safetyPattern.test(screenText)) {
    await syncUpdate(serial, item, { errorMessage: "로그인 만료, 접근 제한 또는 추가 인증 화면이 감지되었습니다.", safetyStop: true });
    return false;
  }
  const soldOutPattern = new RegExp(config.soldOutRegex ?? "품절|판매.{0,4}종료|구매.{0,4}불가|sold\\s*out", "i");
  if (soldOutPattern.test(screenText)) {
    await syncUpdate(serial, item, { availability: "SOLD_OUT" });
    return true;
  }
  const prices = [...screenText.matchAll(new RegExp(config.priceRegex, "g"))]
    .map((match) => Number(String(match[1]).replace(/,/g, "")))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (!prices.length) {
    await syncUpdate(serial, item, { errorMessage: "상품 화면에서 판매 가격을 판독하지 못했습니다.", safetyStop: true });
    return false;
  }
  await syncUpdate(serial, item, { availability: "AVAILABLE", observedPrice: Math.min(...prices) });
  return true;
}

async function runCatalogSync(serial) {
  const maxItems = Math.min(500, Math.max(1, Number(config.syncMaxItemsPerRun ?? 200)));
  let minimumDelay = 3000;
  let maximumDelay = 5000;
  console.log(`포카마켓 가격 최신화 확인 · 최대 ${maxItems}개`);
  for (let count = 0; count < maxItems; count += 1) {
    const { item, speed = {} } = await api(`/api/pocamarket-bridge/sync?device=${encodeURIComponent(serial)}`);
    minimumDelay = Math.max(1000, Number(config.syncMinDelayMs ?? speed.minDelayMs ?? 3000));
    maximumDelay = Math.max(minimumDelay, Number(config.syncMaxDelayMs ?? speed.maxDelayMs ?? 5000));
    if (!item) return console.log(`최신화 대기 작업이 없습니다. 처리 ${count}개`);
    try {
      if (!await inspectCatalogItem(serial, item, speed)) return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await syncUpdate(serial, item, { errorMessage: message, safetyStop: true });
      console.error(`[${item.productNumber}] ${message}`);
      return;
    }
    if (count + 1 < maxItems) await wait(randomDelay(minimumDelay, maximumDelay));
  }
  console.log(`이번 실행의 안전 한도 ${maxItems}개에 도달해 종료했습니다.`);
}

async function main() {
  if (!existsSync(adb)) throw new Error(`ADB가 없습니다: ${adb}`);
  const serial = deviceSerial();
  if (process.argv.includes("--inspect")) {
    console.log(dumpUi(serial));
    return;
  }
  if (!token) throw new Error("POCAMARKET_BRIDGE_TOKEN 환경변수가 필요합니다.");
  const syncMode = process.argv.includes("--sync") || process.argv.includes("--sync-daemon");
  const requiredKeys = syncMode
    ? ["packageName", "detailUrlTemplate", "priceRegex"]
    : ["packageName", "detailUrlTemplate", "priceRegex", "quickBuyRowX", "quickBuyRowY", "checkoutButtonText"];
  for (const key of requiredKeys) {
    if (!config[key]) throw new Error(`설정 파일에 ${key} 값이 필요합니다: ${configPath}`);
  }
  console.log(`포카마켓 구매 연결 시작 · 장치 ${serial}`);
  if (syncMode) {
    if (process.argv.includes("--sync-daemon")) {
      console.log("포카마켓 최신화 상시 브리지 시작");
      while (true) {
        await runCatalogSync(serial);
        await wait(30000);
      }
    }
    await runCatalogSync(serial);
    return;
  }
  while (true) {
    const { job } = await api(`/api/pocamarket-bridge/jobs?device=${encodeURIComponent(serial)}`);
    if (job) {
      try { await processJob(serial, job); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[${job.id}] ${message}`);
        await update(job.id, { status: "failed", errorMessage: message });
      }
    }
    await wait(job ? 1000 : 5000);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
