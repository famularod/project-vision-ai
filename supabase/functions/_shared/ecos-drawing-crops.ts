import { PNG } from "npm:pngjs@7.0.0";
import { Buffer } from "node:buffer";
import type { ECOSProtectedDocumentPage } from "./ecos-protected-drawing-image-protocol.ts";
import { ECOS_DRAWING_IMAGE_BYTES } from "./ecos-drawing-media-budget.ts";

export type ECOSDrawingView = Readonly<{
  viewId: string;
  parentRasterSha256: string;
  cropSha256: string;
  parentWidth: number;
  parentHeight: number;
  pixelBox: readonly [number, number, number, number];
  width: number;
  height: number;
}>;
export type ECOSDrawingCrop = Readonly<{ image: ECOSProtectedDocumentPage; view: ECOSDrawingView }>;
// Bound decoded-image memory per process. No unbounded work queue or detached
// crop jobs; the caller can retry a busy read within its existing question budget.
let decoding = false;

/** Deterministic overlapping native-pixel views; no OCR, invented pixels,
 * rescaling, URL reads, file writes or question-specific region selection.
 * Complete geometric coverage is NOT complete semantic understanding.
 */
export async function createECOSDrawingCrops(
  page: ECOSProtectedDocumentPage, signal: AbortSignal,
): Promise<readonly ECOSDrawingCrop[]> {
  signal.throwIfAborted();
  if (decoding) throw new Error("drawing_crop_busy");
  decoding = true;
  try {
    const prefix = "data:image/png;base64,";
    if (!page.dataUrl.startsWith(prefix)) invalid();
    const base64 = page.dataUrl.slice(prefix.length);
    if (base64.length > 4 * Math.ceil(8 * 1024 * 1024 / 3) || base64.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) invalid();
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length < 33 || bytes.toString("base64") !== base64 ||
      await digest(bytes) !== page.sha256) invalid();
    if ([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].some((n,i) => bytes[i] !== n)) invalid();
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    // Reject interlacing BEFORE pngjs: its interlaced sync path inflates without
    // the non-interlaced output-length bound. Hosted rasters use 8-bit PNG.
    if (!width || !height || width > 8000 || height > 8000 || width * height > 24_000_000 ||
      width !== page.width || height !== page.height ||
      bytes[24] !== 8 || ![0,2,4,6].includes(bytes[25]) ||
      bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) invalid();
    signal.throwIfAborted();
    const decoded = PNG.sync.read(bytes, {checkCRC:true});
    if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) invalid();
    const views = drawingViewBoxes(width,height);
    let totalBytes = 0;
    const crops: ECOSDrawingCrop[] = [];
    for (const [index, box] of views.entries()) {
      // Let cancellation/deadline callbacks run between bounded CPU operations.
      await new Promise(resolve => setTimeout(resolve,0));
      signal.throwIfAborted();
      const [left,top,right,bottom] = box;
      const cropWidth = right-left, cropHeight = bottom-top;
      const data = Buffer.alloc(cropWidth * cropHeight * 4);
      for (let y=0;y<cropHeight;y++) {
        decoded.data.copy(data,y*cropWidth*4,((top+y)*width+left)*4,((top+y)*width+right)*4);
      }
      const encoded: Buffer = PNG.sync.write({width:cropWidth,height:cropHeight,data},
        {colorType:6,bitDepth:8,deflateLevel:6,filterType:-1});
      totalBytes += encoded.length;
      if (totalBytes > ECOS_DRAWING_IMAGE_BYTES) throw new Error("drawing_crop_byte_budget_exceeded");
      const sha256 = await digest(encoded);
      crops.push(Object.freeze({
        image:Object.freeze({dataUrl:prefix+encoded.toString("base64"),width:cropWidth,height:cropHeight,sha256}),
        view:Object.freeze({viewId:"T"+(index+1),parentRasterSha256:page.sha256,cropSha256:sha256,
          parentWidth:width,parentHeight:height,pixelBox:Object.freeze(box),
          width:cropWidth,height:cropHeight}),
      }));
    }
    signal.throwIfAborted();
    return Object.freeze(crops);
  } finally { decoding = false; }
}

export function drawingViewBoxes(width:number,height:number): [number,number,number,number][] {
  if (![width,height].every(n=>Number.isSafeInteger(n) && n>0 && n<=8000) || width*height>24_000_000) invalid();
  // Tiny sources need only one view; never pad or upscale them.
  if (width<=1300 && height<=1300) return [[0,0,width,height]];
  const columns=width<=1300?1:3, rows=height<=1300?1:3;
  const boxes: [number,number,number,number][] = [];
  for (let row=0;row<rows;row++) for (let column=0;column<columns;column++) {
    boxes.push([
      Math.max(0,Math.floor(width*(column/columns-0.02))),
      Math.max(0,Math.floor(height*(row/rows-0.02))),
      Math.min(width,Math.ceil(width*((column+1)/columns+0.02))),
      Math.min(height,Math.ceil(height*((row+1)/rows+0.02))),
    ]);
  }
  return boxes;
}
async function digest(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)))]
    .map(value=>value.toString(16).padStart(2,"0")).join("");
}
function invalid(): never { throw new Error("drawing_crop_source_invalid"); }
