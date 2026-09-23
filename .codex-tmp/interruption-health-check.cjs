const fs=require('fs');
(async()=>{const base='https://ebay-order-manager-lake.vercel.app', cookie=fs.readFileSync('.codex-tmp/feed-session.txt','utf8');const results=await Promise.all([
fetch(base+'/api/health').then(r=>({health:r.status})),
fetch(base+'/api/pocamarket-sync/batches').then(r=>({unauthenticated:r.status})),
fetch(base+'/api/ebay/connection-status',{headers:{cookie}}).then(async r=>({ebayHttp:r.status,connected:(await r.json()).ok})),
]);console.log(JSON.stringify(results));})();
