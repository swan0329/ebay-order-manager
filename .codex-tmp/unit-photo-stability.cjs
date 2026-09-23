const fs=require('fs'),http=require('http'),assert=require('assert/strict'),esbuild=require('esbuild');
const {chromium}=require('./unit-ui-check/node_modules/playwright');
(async()=>{
const component=process.argv.includes('--old')?'./.codex-tmp/image-display-deploy/src/components/UnitMembersClient':'./src/components/UnitMembersClient';
const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{UnitMembersClient}from'${component}';createRoot(document.getElementById('root')).render(<main style={{maxWidth:1500,padding:16,margin:'auto'}}><UnitMembersClient items={[{id:'a',sku:'A',brand:'BTS',productName:'Card A',category:null,imageUrl:'/photo.svg',searchImageUrl:'https://example.com/card.jpg'}]}/></main>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic'});
const css=fs.readdirSync('.next/static/css').filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync('.next/static/css/'+p,'utf8')).join('\n');
const server=http.createServer((req,res)=>{
if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text)}
if(req.url==='/photo.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="700" height="1000"><rect width="700" height="1000" fill="purple"/></svg>')}
if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end('{"members":["Jin"]}')}
res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><style>${css}\n::-webkit-scrollbar{width:17px;height:17px}</style><div id="root"></div><script src="/bundle.js"></script></html>`)
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
const page=await browser.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth===700);
const results=[];
for(const viewport of [{width:1400,height:1001},{width:1280,height:901},{width:800,height:721},{width:390,height:843}]){
await page.setViewportSize(viewport);
for(const action of ['reset','rotate','zoom']){
await page.getByRole('button',{name:action==='reset'?'사진 크기와 회전 초기화':action==='rotate'?'사진 오른쪽으로 회전':'사진 확대',exact:true}).click();
await page.waitForTimeout(250);
const samples=await page.evaluate(async()=>{const sizes=[];for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);const img=document.querySelector('img'); if(getComputedStyle(img).visibility!=='visible' || !img.complete || img.naturalWidth<2) throw new Error('Photo must be loaded and visible');const rect=img.getBoundingClientRect();sizes.push(`${rect.width.toFixed(2)}x${rect.height.toFixed(2)}`)}return [...new Set(sizes)]});
results.push({viewport,action,sizes:samples});assert.equal(samples.length,1,JSON.stringify(results.at(-1)));
}
}
assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({passed:true,checks:results.length,results}));
}finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

