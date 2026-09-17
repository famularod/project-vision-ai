import {PNG} from "npm:pngjs@7.0.0";
import {Buffer} from "node:buffer";
import {assert,assertEquals,assertRejects,assertThrows} from "jsr:@std/assert@1";
import {createECOSDrawingCrops,drawingViewBoxes} from "./ecos-drawing-crops.ts";
const signal=()=>new AbortController().signal;
async function page(width=1501,height=1403) {
  const data=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    data[i]=x%251;data[i+1]=y%251;data[i+2]=(x+y)%251;data[i+3]=255;
  }
  const bytes:Buffer=PNG.sync.write({width,height,data});
  const sha256=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)))]
    .map(n=>n.toString(16).padStart(2,"0")).join("");
  return {dataUrl:"data:image/png;base64,"+bytes.toString("base64"),width,height,sha256};
}
Deno.test("crop views preserve parent pixels, exact geometry and source hashes",async()=>{
  const original=await page();
  const crops=await createECOSDrawingCrops(original,signal());
  assertEquals(crops.length,9);
  for(const crop of crops){
    const png=PNG.sync.read(Buffer.from(crop.image.dataUrl.split(",")[1],"base64"));
    const [left,top,right,bottom]=crop.view.pixelBox;
    assertEquals([png.width,png.height],[right-left,bottom-top]);
    assertEquals(crop.view.parentRasterSha256,original.sha256);
    assertEquals(crop.view.cropSha256,crop.image.sha256);
    for(const [x,y] of [[0,0],[png.width-1,png.height-1],[10,10]]){
      const offset=(y*png.width+x)*4;
      assertEquals([...png.data.subarray(offset,offset+4)],
        [(left+x)%251,(top+y)%251,(left+x+top+y)%251,255]);
    }
  }
});
Deno.test("crop layout covers boundaries and odd dimensions without gaps or duplicate skinny views",()=>{
  for(const [width,height] of [[1501,1403],[4620,3300],[8000,2000],[1,8000],[1300,1300],[1301,10]]){
    const boxes=drawingViewBoxes(width,height);
    assert(boxes.length<=9);
    assertEquals(new Set(boxes.map(b=>JSON.stringify(b))).size,boxes.length);
    for(const b of boxes)assert(b[0]>=0&&b[1]>=0&&b[2]<=width&&b[3]<=height&&b[0]<b[2]&&b[1]<b[3]);
    for(let y=0;y<height;y+=Math.max(1,Math.floor(height/97)))for(let x=0;x<width;x+=Math.max(1,Math.floor(width/97))){
      assert(boxes.some(([l,t,r,b])=>x>=l&&x<r&&y>=t&&y<b));
    }
    assert(boxes.some(b=>b[2]===width&&b[3]===height));
  }
  for(const [w,h] of [[0,1],[-1,2],[9000,1],[6000,6000],[2.5,3]])assertThrows(()=>drawingViewBoxes(w,h));
});
Deno.test("cropper rejects mismatched parent fingerprint or dimensions and never upscales",async()=>{
  const original=await page(12,10);
  await assertRejects(()=>createECOSDrawingCrops({...original,sha256:"f".repeat(64)},signal()));
  await assertRejects(()=>createECOSDrawingCrops({...original,width:13},signal()));
  const crops=await createECOSDrawingCrops(original,signal());
  assertEquals(crops.length,1);
  assertEquals(crops[0].view.pixelBox,[0,0,12,10]);
});
Deno.test("cropper rejects interlacing before entering its unbounded inflate path",async()=>{
  const original=await page(12,10);
  const bytes=Buffer.from(original.dataUrl.split(",")[1],"base64");bytes[28]=1;
  const sha256=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)))]
    .map(n=>n.toString(16).padStart(2,"0")).join("");
  await assertRejects(()=>createECOSDrawingCrops({...original,dataUrl:"data:image/png;base64,"+bytes.toString("base64"),sha256},signal()));
});
Deno.test("cropper bounds concurrent decode work and releases the slot after cancellation",async()=>{
  const original=await page(12,10),controller=new AbortController();
  const running=createECOSDrawingCrops(original,controller.signal);
  await assertRejects(()=>createECOSDrawingCrops(original,signal()),Error,"drawing_crop_busy");
  controller.abort();await assertRejects(()=>running);
  assertEquals((await createECOSDrawingCrops(original,signal())).length,1);
});
