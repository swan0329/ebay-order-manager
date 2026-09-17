import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
nextEnv.loadEnvConfig(root);
const adb = process.env.ADB_PATH || path.join(root, "tools", "platform-tools", "adb.exe");
const configPath = process.env.POCAMARKET_BRIDGE_CONFIG || path.join(root, "pocamarket-bridge.config.json");
const pagePath = path.join(root, "scripts", "pocamarket-phone-connect.html");
const port = 43127;
const baseUrl = `http://127.0.0.1:${port}`;
let bridge = null;
let bridgeState = "stopped";
let bridgeMessage = "휴대전화 연결 후 자동으로 시작됩니다.";

if (!existsSync(adb)) throw new Error(`ADB를 찾지 못했습니다: ${adb}`);

async function adbRun(...args) {
  const result = await execFileAsync(adb, args, { encoding: "utf8", timeout: 20_000, windowsHide: true });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

async function connectedDevices() {
  const output = await adbRun("devices");
  return output.split(/\r?\n/).slice(1).map((line) => line.trim())
    .filter((line) => /\sdevice(?:\s|$)/.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

function validAddress(value) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(value)) return false;
  const [host, portText] = value.split(":");
  return host.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255)
    && Number(portText) >= 1 && Number(portText) <= 65535;
}

async function tryConnect(address) {
  if (!validAddress(address)) return false;
  await adbRun("connect", address).catch(() => "");
  return (await connectedDevices()).includes(address);
}

async function discoverAddresses() {
  const output = await adbRun("mdns", "services").catch(() => "");
  return [...output.matchAll(/_adb-tls-connect\._tcp\s+(\S+:\d+)/g)]
    .map((match) => match[1]).filter(validAddress);
}

async function discoverPairingAddresses() {
  const output = await adbRun("mdns", "services").catch(() => "");
  return [...output.matchAll(/_adb-tls-pairing\._tcp\s+(\S+:\d+)/g)]
    .map((match) => match[1]).filter(validAddress);
}

function readConfig() {
  return existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")) : {};
}

function saveAddress(address) {
  const config = readConfig();
  config.adbAddress = address;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function deviceInfo() {
  const devices = await connectedDevices();
  if (!devices.length) return { connected: false, devices };
  const identities = await Promise.all(devices.map(async (device) => ({
    device,
    hardwareSerial: await adbRun("-s", device, "shell", "getprop", "ro.serialno").catch(() => device),
  })));
  const hardwareDevices = new Set(identities.map((item) => item.hardwareSerial || item.device));
  if (hardwareDevices.size !== 1) return { connected: false, devices };
  const serial = identities.find((item) => /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(item.device))?.device
    ?? devices[0];
  const model = await adbRun("-s", serial, "shell", "getprop", "ro.product.model").catch(() => "Android");
  return { connected: true, devices, serial, model: model || "Android", duplicateConnections: Math.max(0, devices.length - 1) };
}

function startBridge() {
  if (bridge && bridge.exitCode === null) return;
  if (!process.env.POCAMARKET_BRIDGE_TOKEN?.trim()) {
    bridgeState = "error";
    bridgeMessage = "PC에 구매 연결 토큰이 설정되지 않았습니다.";
    return;
  }
  bridgeState = "running";
  bridgeMessage = "구매 요청을 기다리고 있습니다. 이 창을 닫지 마세요.";
  bridge = spawn(process.execPath, [path.join(root, "scripts", "pocamarket-bridge.mjs")], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const receive = (chunk) => {
    const line = String(chunk).trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (line) bridgeMessage = line.slice(0, 300);
  };
  bridge.stdout.on("data", receive);
  bridge.stderr.on("data", receive);
  bridge.on("exit", (code) => {
    bridgeState = "error";
    bridgeMessage = `구매 연결이 종료되었습니다${code == null ? "" : ` (코드 ${code})`}. 다시 시작해 주세요.`;
  });
}

async function bootstrapConnection() {
  await adbRun("start-server");
  let info = await deviceInfo();
  if (info.connected) return info;
  const saved = readConfig().adbAddress;
  if (typeof saved === "string" && await tryConnect(saved)) return deviceInfo();
  for (const address of await discoverAddresses()) {
    if (await tryConnect(address)) {
      saveAddress(address);
      return deviceInfo();
    }
  }
  return info;
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("입력값이 너무 큽니다.");
  }
  return JSON.parse(raw || "{}");
}

function trustedRequest(request) {
  return request.headers.origin === baseUrl && request.headers["x-pocamarket-helper"] === "1";
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", baseUrl);
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(readFileSync(pagePath));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      const device = await deviceInfo();
      if (device.connected) startBridge();
      const pairingAddresses = device.connected ? [] : await discoverPairingAddresses();
      json(response, 200, { device, pairingAddress: pairingAddresses.length === 1 ? pairingAddresses[0] : null, bridge: { state: bridgeState, message: bridgeMessage } });
      return;
    }
    if (request.method !== "POST" || !trustedRequest(request)) {
      json(response, 403, { error: "허용되지 않은 요청입니다." });
      return;
    }
    const body = await readJson(request);
    if (url.pathname === "/api/pair") {
      const address = String(body.address ?? "").trim();
      const code = String(body.code ?? "").trim();
      if (!validAddress(address) || !/^\d{6}$/.test(code)) {
        json(response, 422, { error: "페어링 주소와 숫자 6자리 코드를 확인해 주세요." });
        return;
      }
      const output = await adbRun("pair", address, code);
      if (!/Successfully paired/i.test(output)) throw new Error("페어링에 실패했습니다. 새 코드를 열어 다시 시도해 주세요.");
      for (const discovered of await discoverAddresses()) {
        if (await tryConnect(discovered)) {
          saveAddress(discovered);
          const device = await deviceInfo();
          startBridge();
          json(response, 200, { ok: true, connected: true, device });
          return;
        }
      }
      json(response, 200, { ok: true, connected: false });
      return;
    }
    if (url.pathname === "/api/connect") {
      const address = String(body.address ?? "").trim();
      if (!validAddress(address)) {
        json(response, 422, { error: "무선 디버깅 메인 화면의 IP 주소와 포트를 확인해 주세요." });
        return;
      }
      if (!await tryConnect(address)) throw new Error("휴대전화에 연결하지 못했습니다. 같은 Wi-Fi와 무선 디버깅 상태를 확인해 주세요.");
      saveAddress(address);
      const device = await deviceInfo();
      startBridge();
      json(response, 200, { ok: true, device });
      return;
    }
    if (url.pathname === "/api/auto-connect") {
      const device = await bootstrapConnection();
      if (!device.connected) {
        json(response, 404, { error: "자동 검색에서 휴대전화를 찾지 못했습니다. 아래 주소 입력으로 연결해 주세요." });
        return;
      }
      startBridge();
      json(response, 200, { ok: true, device });
      return;
    }
    json(response, 404, { error: "요청을 찾을 수 없습니다." });
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message.slice(0, 300) : "연결 중 오류가 발생했습니다." });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    if (!process.argv.includes("--no-open")) execFile("rundll32.exe", ["url.dll,FileProtocolHandler", baseUrl]);
    process.exit(0);
  }
  throw error;
});

server.listen(port, "127.0.0.1", async () => {
  const info = await bootstrapConnection().catch(() => ({ connected: false }));
  if (info.connected) startBridge();
  if (!process.argv.includes("--no-open")) execFile("rundll32.exe", ["url.dll,FileProtocolHandler", baseUrl]);
  console.log(`포카마켓 휴대전화 연결 페이지: ${baseUrl}`);
});

function shutdown() {
  if (bridge && bridge.exitCode === null) bridge.kill();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
