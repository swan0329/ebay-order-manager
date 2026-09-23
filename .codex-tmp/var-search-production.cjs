const fs=require('fs'),assert=require('assert/strict');
const {chromium}=require('./unit-ui-check/node_modules/playwright');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
const context=await browser.newContext();const base='https://ebay-order-manager-lake.vercel.app';
const header=fs.readFileSync('.codex-tmp/bts-request-headers.txt','utf8').split(/\r?\n/).find(s=>/^cookie:/i.test(s));assert.ok(header);
await context.addCookies(header.replace(/^cookie:\s*/i,'').split(';').map(s=>{const p=s.trim(),i=p.indexOf('=');return {name:p.slice(0,i),value:p.slice(i+1),url:base}}));
const page=await context.newPage();await page.route('**/*',r=>r.request().resourceType()==='image'?r.abort():r.continue());
await page.goto(base+'/listing-upload/variation-groups',{waitUntil:'domcontentloaded'});
const search=page.getByRole('textbox',{name:'묶음상품 검색'});await search.waitFor({timeout:60000});await search.fill('VAR-WR1U63');
const article=page.locator('article').filter({hasText:'VAR-WR1U63'});await article.waitFor();assert.equal(await article.count(),1);assert.ok((await article.textContent()).includes('PLVE'));
for(const q of ['158183489442','https://www.ebay.com/itm/158183489442','421031']){await search.fill(q);await article.waitFor()}
await search.fill('VAR-WR1U63');await article.getByRole('link',{name:'재고관리에서 구성 카드 보기'}).click();await page.waitForURL('**/products?q=VAR-WR1U63');await page.getByText('421031',{exact:true}).first().waitFor({timeout:60000});
console.log(JSON.stringify({passed:true,groupSearch:true,ebayIdAndUrl:true,childSku:true,inventoryNavigation:true}));
}finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
