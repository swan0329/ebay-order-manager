const fs=require('fs');const assert=require('assert/strict');const {chromium}=require('./unit-ui-check/node_modules/playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const origin='https://ebay-order-manager-lake.vercel.app';const context=await browser.newContext({viewport:{width:1680,height:1100}});
 const cookieLine=fs.readFileSync('.codex-tmp/bts-request-headers.txt','utf8').split(/\r?\n/).find(x=>/^cookie:/i.test(x));if(!cookieLine)throw Error('Missing existing admin cookie header');
 await context.addCookies(cookieLine.replace(/^cookie:\s*/i,'').split(';').map(x=>{const i=x.indexOf('=');return{name:x.slice(0,i).trim(),value:x.slice(i+1).trim(),url:origin}}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let blocked=0;
 await page.route('**/api/**',route=>{if(route.request().method()!=='GET'){blocked++;return route.abort();}return route.continue();});
 const countsReady=page.waitForResponse(r=>r.url().includes('/api/products/channel-operation-counts'),{timeout:60000});
 await page.goto(origin+'/products',{waitUntil:'domcontentloaded',timeout:120000});
 const countsResponse=await countsReady;assert.equal(countsResponse.status(),200);const counts=await countsResponse.json();assert.equal(typeof counts.ebay.register,'number');for(const channel of ['ebay','shopify']){const c=counts[channel],b=c.registrationBreakdown;assert.equal(b.readyCount,c.register+b.linkedExcludedCount+b.priceMissingCount);}console.log(JSON.stringify({reconciliation:{ebay:counts.ebay,shopify:counts.shopify}}));
 await page.getByRole('heading',{name:'판매채널 자동 반영',exact:true}).waitFor({timeout:60000});
 await page.getByRole('link',{name:'내부 상품 추가',exact:true}).waitFor();await page.getByRole('link',{name:'eBay 등록 준비 후보 상품 조회',exact:true}).waitFor();await page.getByText('상단의 ‘등록 준비 후보’와 다른 이유',{exact:true}).waitFor();
 const sales=page.locator('section').filter({has:page.getByRole('heading',{name:'판매채널 자동 반영',exact:true})}).first();
 await sales.scrollIntoViewIfNeeded();await sales.screenshot({path:'.codex-tmp/counts-fix-live-default.png'});
 const summary=page.locator('summary').filter({hasText:'시험등록·신규등록'});await summary.click();await page.getByRole('button',{name:'여러 상품 신규등록',exact:true}).click();await page.getByLabel('등록 작업 수').fill('25');await summary.click();await summary.click();assert.equal(await page.getByLabel('등록 작업 수').inputValue(),'25');
 await sales.screenshot({path:'.codex-tmp/counts-fix-live-expanded.png'});
 assert.equal(await page.getByLabel('변동처리 상품번호').isVisible(),true);assert.equal(await page.getByRole('button',{name:'신규등록 시작',exact:true}).isVisible(),true);assert.equal(blocked,0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,url:page.url(),checks:['production layout','inventory toolbar','SKU input visible','registration expand/collapse','bulk count preserved'],writeRequests:blocked}));
 }finally{await browser.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});
