import { expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { createPreparedListingImage } from "@/lib/ebay-watermarked-images";
import { createVariationThumbnailBase } from "@/lib/variation-thumbnail";
import { listingImageBox } from "@/lib/listing-image-layout";

it("rounds the actual card corners while preserving its top edge and center",async()=>{
  const source=await sharp({create:{width:300,height:500,channels:3,background:'#ff0000'}}).png().toBuffer();
  const out=await createPreparedListingImage(source,settings,{});
  const box=listingImageBox({},false), left=Math.round(box.left+(box.width-box.height*0.6)/2);
  const pixel=async(x:number,y:number)=>sharp(out).removeAlpha().extract({left:x,top:y,width:1,height:1}).raw().toBuffer();
  const corner=await pixel(left+1,box.top+1),edge=await pixel(400,box.top+2);
  expect(corner[1]).toBeGreaterThan(240);
  expect(edge[0]).toBeGreaterThan(240);expect(edge[1]).toBeLessThan(10);
});

it("includes the 48th card instead of silently limiting a group to 40",async()=>{
  const red=await sharp({create:{width:24,height:38,channels:3,background:'red'}}).png().toBuffer();
  const blue=await sharp({create:{width:24,height:38,channels:3,background:'blue'}}).png().toBuffer();
  const urls=Array.from({length:48},(_,i)=>`https://test/${i}`);
  const fetcher=vi.fn(async(url:string)=>new Response(new Uint8Array(url.endsWith('/47')?blue:red)));
  vi.stubGlobal('fetch',fetcher);
  try{
    const out=await createVariationThumbnailBase({groupName:'SKZ',albumName:'48 cards',imageUrls:urls});
    const pixels=await sharp(out).removeAlpha().raw().toBuffer();let bluePixels=0;
    for(let i=0;i<pixels.length;i+=3)if(pixels[i+2]>200&&pixels[i]<30)bluePixels++;
    expect(fetcher).toHaveBeenCalledTimes(48);expect(bluePixels).toBeGreaterThan(100);
  }finally{vi.unstubAllGlobals();}
},60000);

it("aligns the displayed top and bottom for different source ratios and source types",async()=>{
  const bounds=[];
  for(const [w,h] of [[300,500],[540,860],[860,540]]) {
    for(const eligible of [true,false]) {
      const source=await sharp({create:{width:w,height:h,channels:3,background:'#ff0000'}}).png().toBuffer();
      const out=await createPreparedListingImage(source,{...settings,paddingLeft:90,paddingRight:70,paddingTop:40,paddingBottom:80},{backgroundEligible:eligible});
      const {data,info}=await sharp(out).removeAlpha().raw().toBuffer({resolveWithObject:true});
      let top=1200,bottom=0,left=1200,right=0;
      for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*3;if(data[i]>240&&data[i+1]<10&&data[i+2]<10){top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);}}
      bounds.push([top,bottom]);
      expect((right-left+1)/(bottom-top+1)).toBeCloseTo(Math.min(w,h)/Math.max(w,h),2);
    }
  }
  expect(new Set(bounds.map(b=>b.join(','))).size).toBe(1);
});

const settings = { watermarkOpacity: 0.06, watermarkLogoSize: 50, watermarkGap: 25 };
const marked = (w:number,h:number) => Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="red"/><rect width="100%" height="20" fill="lime"/><rect y="${h-20}" width="100%" height="20" fill="blue"/><rect width="20" height="100%" fill="yellow"/><rect x="${w-20}" width="20" height="100%" fill="magenta"/></svg>`);
async function assertEdges(out:Buffer,size:number) {
  const {data,info}=await sharp(out).removeAlpha().raw().toBuffer({resolveWithObject:true});
  expect([info.width,info.height]).toEqual([800,size]);
  for(const color of [[0,255,0],[0,0,255],[255,255,0],[255,0,255]]) {
    let count=0;
    for(let i=0;i<data.length;i+=3) if(color.every((v,c)=>Math.abs(data[i+c]-v)<20))count++;
    expect(count).toBeGreaterThan(20);
  }
}
it.each([[300,500],[500,300],[400,400]])("preserves all edges of %i×%i cards including rotation and maximum zoom",async(w,h)=>{
  for(const rotation of [0,90,33]) await assertEdges(await createPreparedListingImage(marked(w,h),{...settings,imageRotation:rotation,imageZoom:100,paddingTop:-300},{backgroundEligible:true}),1200);
});
it("preserves portrait and landscape edges in a group thumbnail",async()=>{
  const pngs=await Promise.all([marked(300,500),marked(500,300)].map(b=>sharp(b).png().toBuffer()));
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>new Response(new Uint8Array(pngs[url.endsWith('a')?0:1]))));
  try{await assertEdges(await createVariationThumbnailBase({groupName:"BTS",albumName:"Test",imageUrls:["https://test/a","https://test/b"]}),1200);}finally{vi.unstubAllGlobals();}
});
it('preserves full wide cards and respects disabled background and enabled shadow',async()=>{
 const background=await sharp({create:{width:10,height:10,channels:3,background:'blue'}}).png().toBuffer();
 const source=await sharp({create:{width:840,height:1000,channels:3,background:'red'}}).png().toBuffer();
 const plain=await createPreparedListingImage(source,{...settings,backgroundEnabled:false},{backgroundEligible:true,background});
 const corner=await sharp(plain).extract({left:0,top:0,width:1,height:1}).removeAlpha().raw().toBuffer();expect([...corner]).toEqual([255,255,255]);
 const shaded=await createPreparedListingImage(source,{...settings,backgroundEnabled:false,shadowEnabled:true},{backgroundEligible:true,background});expect(shaded.equals(plain)).toBe(false);
 const {data,info}=await sharp(plain).removeAlpha().raw().toBuffer({resolveWithObject:true});let left=800,right=0,top=1200,bottom=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*3;if(data[i]>240&&data[i+1]<10){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
 expect((right-left+1)/(bottom-top+1)).toBeCloseTo(.84,2);expect(left).toBeGreaterThan(0);expect(top).toBeGreaterThan(0);expect(right).toBeLessThan(799);expect(bottom).toBeLessThan(1199);
});
