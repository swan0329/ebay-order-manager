const fs=require('fs'),assert=require('assert/strict');
const {chromium}=require('./unit-ui-check/node_modules/playwright');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
const context=await browser.newContext();const url='https://ebay-order-manager-lake.vercel.app';
const header=fs.readFileSync('.codex-tmp/bts-request-headers.txt','utf8').split(/\r?\n/).find(s=>/^cookie:/i.test(s));assert.ok(header,'admin session header exists');
await context.addCookies(header.replace(/^cookie:\s*/i,'').split(';').map(s=>{const p=s.trim(),i=p.indexOf('=');return {name:p.slice(0,i),value:p.slice(i+1),url}}));
const page=await context.newPage();await page.goto(url+'/products/unit-members');console.log({url:page.url(),title:await page.title(),headings:await page.locator('h1,h2').allTextContents()});await page.locator('[data-card-photo-frame]').waitFor();await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth>1);
await page.waitForFunction(()=>document.querySelector('img')?.style.width.includes('cq'));await page.getByRole('button',{name:'전체 선택',exact:true}).click();const preview=page.getByText('판매 제목 미리보기',{exact:true}).locator('..').locator('p').first();await preview.waitFor();const previewTitle=await preview.textContent();assert.ok(previewTitle.includes('Group OT7'));assert.ok(previewTitle.length<=80);console.log({previewTitle,characters:previewTitle.length});await page.getByRole('button',{name:'선택 해제',exact:true}).click();const results=[];
for(const viewport of [{width:1400,height:1001},{width:390,height:843}]){
await page.setViewportSize(viewport);
for(const name of ['사진 크기와 회전 초기화','사진 오른쪽으로 회전','사진 확대']){
await page.getByRole('button',{name,exact:true}).click();await page.waitForTimeout(300);
const sizes=await page.evaluate(async()=>{const out=[];for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const img=document.querySelector('img');if(getComputedStyle(img).visibility!=='visible' || !img.complete || img.naturalWidth<2)throw new Error('Photo is hidden or not loaded');const r=img.getBoundingClientRect();out.push(`${r.width.toFixed(2)}x${r.height.toFixed(2)}`)}return [...new Set(out)]});
assert.equal(sizes.length,1,JSON.stringify({viewport,name,sizes}));results.push({viewport,name,sizes});
}}
await page.reload();await page.waitForFunction(()=>{const i=document.querySelector('img');return i?.complete && i.naturalWidth>1 && getComputedStyle(i).visibility==='visible' && i.getBoundingClientRect().width>100});await page.setViewportSize({width:1400,height:1001});await page.screenshot({path:' .codex-tmp/unit-visible-production.png'.trim(),fullPage:true});console.log(JSON.stringify({passed:true,production:true,cachedReloadVisible:true,results}));
}finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});




