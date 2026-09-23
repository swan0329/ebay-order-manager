from pathlib import Path
p=Path('src/components/PocamarketPurchaseButton.tsx');s=p.read_text();s=s.replace('const initial = window.setTimeout(() => void refresh(), 0);\n    const timer = window.setInterval(() => void refresh(), 5000);\n    return () => { window.clearTimeout(initial); window.clearInterval(timer); };','''const check = () => void refresh().catch(() => setMessage("구매 상태 조회가 지연됐습니다. 연결 후 상태 확인을 눌러 주세요."));
    const initial = window.setTimeout(check, 0);
    const timer = window.setInterval(check, 5000);
    window.addEventListener("focus", check);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("focus", check); };''')
s=s.replace('{jobs.map((job)', '''<div className="rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900"><div className="flex flex-wrap gap-2"><a href="http://127.0.0.1:43127/?reconnect=1" target="_blank" rel="noreferrer" className="rounded border border-blue-300 bg-white px-2 py-1 font-semibold">휴대폰 연결·다시 연결</a><button type="button" disabled={loading} onClick={() => void refresh().catch(() => setMessage("구매 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요."))} className="rounded border border-blue-300 bg-white px-2 py-1">연결 후 상태 확인</button></div><p className="mt-1">무선 디버깅을 켠 뒤 다시 연결하세요. 대기 요청은 그대로 이어지므로 구매 버튼을 다시 누를 필요가 없습니다.</p><details className="mt-1"><summary className="cursor-pointer">연결 창이 열리지 않을 때</summary><p>이 PC의 ‘포카마켓-휴대폰-연결.cmd’를 실행한 뒤 다시 누르세요. 휴대폰과 PC는 같은 Wi-Fi여야 합니다. 실패·결제 확인 대기 작업은 자동으로 재구매하지 않습니다.</p></details></div>{jobs.map((job)''')
p.write_text(s)
p=Path('scripts/pocamarket-phone-connect.mjs');s=p.read_text();s=s.replace('import path from "node:path";','import path from "node:path";\nimport nextEnv from "@next/env";');s=s.replace('const root = process.cwd();','const root = process.cwd();\nnextEnv.loadEnvConfig(root);');s=s.replace('    execFile("rundll32.exe", ["url.dll,FileProtocolHandler", baseUrl]);','    if (!process.argv.includes("--no-open")) execFile("rundll32.exe", ["url.dll,FileProtocolHandler", baseUrl]);').replace('  execFile("rundll32.exe", ["url.dll,FileProtocolHandler", baseUrl]);','  if (!process.argv.includes("--no-open")) execFile("rundll32.exe", ["url.dll,FileProtocolHandler", baseUrl]);');p.write_text(s)
p=Path('scripts/pocamarket-phone-connect.html');s=p.read_text();s=s.replace('<div id="status"', '''<section class="card"><h2>무선 디버깅을 다시 켰나요?</h2><p class="hint">같은 Wi-Fi에 연결한 뒤 아래 버튼을 누르세요. 저장된 주소와 새 무선 포트를 찾아 기존 대기 요청을 이어갑니다. 결제 확인 대기·실패 작업은 자동 재구매하지 않습니다.</p><div class="actions"><button id="reconnectButton">다시 연결하고 대기 작업 계속</button><a href="https://ebay-order-manager-lake.vercel.app/orders" target="_blank" rel="noreferrer">주문 화면 열기</a></div></section>
    <div id="status"''')
s=s.replace('$("autoButton").disabled=value','$("autoButton").disabled=value;$("reconnectButton").disabled=value')
s=s.replace('    status();setInterval(status,4000);','''    $("reconnectButton").onclick=()=>$("autoButton").click();
    if(new URLSearchParams(location.search).get("reconnect")==="1")$("autoButton").click();
    status();setInterval(()=>{if(!busy)status()},4000);''')
s=s.replace('재고관리에서 ‘폰으로 구매’','주문 화면에서 대기 작업 확인').replace('상단 상태가 초록색 ‘구매 준비 완료’가 되면 이 페이지를 열어 둔 채 재고관리에서 구매 버튼을 누르세요.','상단 상태가 초록색 ‘구매 준비 완료’가 되면 기존 대기 요청이 자동으로 진행됩니다. 요청을 다시 만들지 말고 주문 화면의 진행 상태를 확인하세요. 결제를 끝낸 뒤 ‘휴대폰 결제 1장 완료’를 눌러야 다음 장이 준비됩니다.')
p.write_text(s)
