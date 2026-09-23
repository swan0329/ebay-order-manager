import fs from 'node:fs';
process.loadEnvFile('.env');
const base='https://ebay-order-manager-lake.vercel.app';
const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({loginId:process.env.ADMIN_LOGIN_ID??process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD})});
console.log('login',r.status);
if(r.ok){fs.writeFileSync('.codex-tmp/feed-session.txt',r.headers.get('set-cookie').split(';')[0]);const me=await r.json();console.log('role',me.user.role);}
