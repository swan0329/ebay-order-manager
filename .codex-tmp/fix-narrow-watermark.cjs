const fs=require('fs'),p='outputs/card-layout-review-2026-09-11/engine/ebay-watermarked-images.ts';let s=fs.readFileSync(p,'utf8');s=s.replace('        placements.push({ input: tile, left: Math.max(0, x), top: Math.max(0, y) });',`        const left = Math.max(0, x), top = Math.max(0, y);
        const width = Math.min(metadata.width, x + tileWidth) - left;
        const height = Math.min(metadata.height, y + tileHeight) - top;
        if (width > 0 && height > 0) {
          const input = await sharp(tile).extract({ left: left - x, top: top - y, width, height }).png().toBuffer();
          placements.push({ input, left, top });
        }`);fs.writeFileSync(p,s);for(const sku of ['15131','12764','12294','101214','4625','13236','group'])fs.copyFileSync(`outputs/card-layout-review-2026-09-11/${sku}-after.jpg`,`outputs/card-layout-review-2026-09-11/${sku}-watermark-before.jpg`);
fs.copyFileSync('outputs/card-layout-review-2026-09-11/engine/review-tests.ts.txt','src/lib/narrow-review.test.ts');
