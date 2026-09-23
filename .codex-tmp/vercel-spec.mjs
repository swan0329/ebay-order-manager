const spec=await (await fetch('https://openapi.vercel.sh')).json();
for(const [path,ops] of Object.entries(spec.paths)){if(/billing\/charges|v3\/events/.test(path))console.log(JSON.stringify({path,operations:ops}));}
