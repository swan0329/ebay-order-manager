const r=await fetch('https://openapi-internal.vercel.sh');
console.log('spec',r.status);
if(r.ok){const s=await r.json();for(const [p,o] of Object.entries(s.paths)){if(/budget|spend|usage-summary/.test(p))console.log(p,Object.keys(o));}}
