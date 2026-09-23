const fs=require('fs'),assert=require('assert/strict');
const {chromium}=require('./unit-ui-check/node_modules/playwright');
const origin=process.argv[2]||'https://ebay-order-manager-lake.vercel.app';
const orderId='cmu21ixk2002ljh04wmd1k765';
const skus=['296333','284272','284806','287832'];
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const context=await browser.newContext({viewport:{width:1500,height:1100}});
  const cookie=fs.readFileSync('.codex-tmp/bts-request-headers.txt','utf8').split(/\r?\n/).find(x=>/^cookie:/i.test(x)).replace(/^cookie:\s*/i,'');
  await context.addCookies(cookie.split(';').map(x=>{const i=x.indexOf('=');return {name:x.slice(0,i).trim(),value:x.slice(i+1).trim(),url:origin}}));
  const page=await context.newPage();const errors=[],mockPurchases=[];let otherWrites=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>{
   if(r.request().method()==='GET')return r.continue();
   if(new URL(r.request().url()).pathname==='/api/pocamarket-purchases'&&r.request().method()==='POST'){
    mockPurchases.push(r.request().postDataJSON());return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({created:[],skipped:['브라우저 검증: 실제 구매 없음']})});
   }otherWrites++;return r.abort();
  });
  await page.goto(origin+'/orders/'+orderId,{waitUntil:'domcontentloaded',timeout:120000});
  await page.getByRole('heading',{name:'판매금액 합계',exact:true}).waitFor({timeout:60000});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'detail desktop horizontal overflow');
  for(const sku of skus){
   assert(await page.locator('img[alt^="'+sku+' "]').count()>=1,'card image '+sku);
  }
  const saleLines=page.getByText('장당 판매금액 10.60 USD',{exact:true});assert.equal(await saleLines.count(),4);
  const summary=page.getByRole('heading',{name:'판매금액 합계',exact:true}).locator('..');
  const summaryText=await summary.innerText();assert(summaryText.includes('42.40 USD'));assert(summaryText.includes('9.00 USD'));assert(summaryText.includes('51.40 USD'));
  assert.equal(await page.getByText(/현재 포카 원가보다 낮게 판매된 주문입니다/).count(),3);
  const editSummary=page.getByText('상품 연결 변경 · 284806',{exact:true});
  await editSummary.click();assert.equal(await editSummary.locator('..').getAttribute('open'),'');
  await editSummary.click();assert.equal(await editSummary.locator('..').getAttribute('open'),null);
  await page.waitForFunction(skus=>skus.every(sku=>{const img=document.querySelector('img[alt^="'+sku+' "]');return img&&img.complete&&img.naturalWidth>0}),skus,{timeout:45000});
  const purchase=page.getByRole('button',{name:'재고없는 포카 구매',exact:true});
  page.once('dialog',d=>d.dismiss());await purchase.click();assert.equal(mockPurchases.length,0);
  page.once('dialog',d=>d.accept());await purchase.click();await page.getByText('브라우저 검증: 실제 구매 없음',{exact:true}).waitFor();await purchase.waitFor({state:'visible'});assert.deepEqual(mockPurchases,[{orderId}]);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='재고없는 포카 구매'&&!b.disabled));
  const address=page.getByRole('heading',{name:'구매자 주소',exact:true}).locator('..');
  await page.screenshot({path:'.codex-tmp/order-details-desktop.png',fullPage:true,mask:[address]});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'detail horizontal overflow');
  await page.screenshot({path:'.codex-tmp/order-details-mobile.png',fullPage:true,mask:[address]});
  await page.goto(origin+'/orders?q=296333&status=ALL',{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('a[href="/orders/'+orderId+'"]').first().waitFor({state:'attached',timeout:60000});
  const mobile=page.locator('section.md\\:hidden');
  const mobileOrder=mobile.locator('a[href="/orders/'+orderId+'"]');
  assert.equal(await mobileOrder.locator('img').count(),4);
  assert((await mobileOrder.innerText()).includes('51.40 USD'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'list mobile overflow');
  await page.setViewportSize({width:1500,height:1100});
  const row=page.locator('tbody tr').filter({has:page.locator('a[href="/orders/'+orderId+'"]')});
  assert.equal(await row.locator('img').count(),4);
  assert.equal(await row.getByText('장당 10.60 USD',{exact:true}).count(),4);
  assert((await row.innerText()).includes('주문 총액 51.40 USD'));
  assert.equal(otherWrites,0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({detailImages:4,listImages:4,mobileImages:4,unitUsd:10.6,merchandiseUsd:42.4,orderTotalUsd:51.4,belowCostWarnings:3,mobileOverflow:false,purchaseCancelRequests:0,mockedPurchaseRequests:mockPurchases.length,actualWriteRequests:0,pageErrors:0}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
