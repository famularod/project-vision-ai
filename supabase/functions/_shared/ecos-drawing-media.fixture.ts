export function imagePart(size = 33) {
  // Header fixture for transport/accounting, not a visual correctness test.
  const bytes = new Uint8Array(size);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  new DataView(bytes.buffer).setUint32(16, 2000);
  new DataView(bytes.buffer).setUint32(20, 1500);
  let binary = "";
  for (let i = 0; i < size; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return {type: "input_image", image_url: "data:image/png;base64," + btoa(binary), detail: "original"};
}
