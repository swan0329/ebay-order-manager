const fs=require('fs');
(async()=>{const skus=['15131','12764','12294','101214','4625','13236','14319','4335','13233','4456'];const s=require('./compare-settings.json').settings;const jobs=skus.map(sku=>({file:'.codex-tmp/equal-source-'+sku, url:JSON.parse(fs.readFileSync('.codex-tmp/source-'+sku+'.json')).sourceUrl}));
if(s.backgroundUrl)jobs.push({file:'.codex-tmp/equal-background',url:s.backgroundUrl});if(s.logoUrl)jobs.push({file:'.codex-tmp/equal-logo',url:s.logoUrl});
for(let i=0;i<jobs.length;i+=4)await Promise.all(jobs.slice(i,i+4).map(async j=>{const r=await fetch(j.url);if(!r.ok)throw Error('HTTP '+r.status);fs.writeFileSync(j.file,Buffer.from(await r.arrayBuffer()));}));console.log('assets',jobs.length);})().catch(e=>{console.error(e.message);process.exitCode=1});
