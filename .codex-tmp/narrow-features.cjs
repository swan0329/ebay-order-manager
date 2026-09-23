const fs=require('fs'),p='outputs/card-layout-review-2026-09-11/engine/ebay-watermarked-images.ts';let s=fs.readFileSync(p,'utf8');s=s.replace('const color = options.backgroundEligible &&','const backgroundActive = options.backgroundEligible && settings.backgroundEnabled !== false;\n  const color = backgroundActive &&').replace('const canvas = options.backgroundEligible && options.background','const canvas = backgroundActive && options.background');s=s.replace('  return canvas.composite([{ input: card, left: box.left, top: box.top }]).png().toBuffer();',`  const layers: sharp.OverlayOptions[] = [];
  if (settings.shadowEnabled) {
    const {data,info} = await sharp(card).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let i=0;i<data.length;i+=4){data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=Math.round(data[i+3]*clamp(settings.shadowOpacity ?? 0.35,0,1));}
    const silhouette=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
    const shadow=await sharp({create:{width:LISTING_IMAGE_WIDTH,height:size,channels:4,background:transparent}}).composite([{input:silhouette,left:Math.round(clamp(box.left+(settings.shadowOffsetX??12),0,LISTING_IMAGE_WIDTH-box.width)),top:Math.round(clamp(box.top+(settings.shadowOffsetY??12),0,size-box.height))}]).png().toBuffer();
    layers.push({input:await sharp(shadow).blur(Math.max(0.3,clamp(settings.shadowBlur??20,0,100))).png().toBuffer(),left:0,top:0});
  }
  layers.push({input:card,left:box.left,top:box.top});
  return canvas.composite(layers).png().toBuffer();`);fs.writeFileSync(p,s);
