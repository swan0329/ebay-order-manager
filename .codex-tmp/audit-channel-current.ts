import {loadEnvConfig} from '@next/env';
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {XMLParser} from 'fast-xml-parser';
loadEnvConfig(process.cwd());
async function main(){
 const {prisma}=await import('../src/lib/prisma');
 try{
 const accounts=await prisma.ebayAccount.findMany({where:{environment:'production'}});
 if(accounts.length!==1)throw Error('Account count '+accounts.length);
 const {getValidAccessToken}=await import('../src/lib/ebay');
 const token=await getValidAccessToken(accounts[0]);
 const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false});
 const items:any[]=[];
 for(let page=1;page<=100;page++){
 const r=await fetch('https://api.ebay.com/ws/api.dll',{method:'POST',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'text/xml','X-EBAY-API-CALL-NAME':'GetMyeBaySelling','X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1423','X-EBAY-API-IAF-TOKEN':token},body:`<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnAll</DetailLevel><ActiveList><Include>true</Include><Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList><SoldList><Include>false</Include></SoldList><UnsoldList><Include>false</Include></UnsoldList></GetMyeBaySellingRequest>`});
 const j=parser.parse(await r.text()).GetMyeBaySellingResponse;
 if(!r.ok||!['Success','Warning'].includes(j?.Ack))throw Error('eBay read failed '+r.status+' '+JSON.stringify(j?.Errors));
 const list=j.ActiveList;items.push(...[list?.ItemArray?.Item??[]].flat());
 console.log('eBay page',page,'items',items.length,'pages',list?.PaginationResult?.TotalNumberOfPages);
 if(page>=Number(list?.PaginationResult?.TotalNumberOfPages||1))break;
 if(page===100)throw Error('Truncated');
 }
 fs.writeFileSync('.codex-tmp/channel-audit-ebay.json',JSON.stringify({observedAt:new Date().toISOString(),items},null,2));
 }finally{await prisma.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
