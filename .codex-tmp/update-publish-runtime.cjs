const fs=require('fs');
const paths=[
'src/app/api/products/publish/route.ts','src/app/api/channel-publish-jobs/route.ts',
'src/app/api/cron/channel-publish/route.ts','src/app/api/shopify/operations/route.ts',
'src/app/api/listing-upload/drafts/upload/route.ts','src/app/api/listing-upload/drafts/retry-failed/route.ts',
];
for(const p of paths){const s=fs.readFileSync(p,'utf8');if(!s.includes('export const maxDuration = 60;'))throw Error(p);fs.writeFileSync(p,s.replace('export const maxDuration = 60;','export const maxDuration = 300;'));}
for(const p of ['vercel.json','.codex-tmp/image-display-deploy/vercel.json']) {
 const j=JSON.parse(fs.readFileSync(p,'utf8'));if(!j.crons.some(x=>x.path==='/api/cron/channel-publish'))j.crons.push({path:'/api/cron/channel-publish',schedule:'* * * * *'});fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
}
