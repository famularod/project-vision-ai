import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const source = process.argv[2] || '';
if (!source) throw new Error('A base64 PDF fixture is required.');
const pdf = await getDocument({ data: new Uint8Array(Buffer.from(source, 'base64')) }).promise;
const pages = [];

for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const lines = content.items.flatMap(item => {
    const text = clean(item.str);
    const transform = Array.isArray(item.transform) ? item.transform : [];
    if (!text || transform.length < 6) return [];
    const height = Math.max(Math.abs(Number(transform[3]) || 0), Number(item.height) || 0, 1);
    const width = Math.max(Number(item.width) || 0, text.length * height * 0.35, 1);
    const x = clamp(Number(transform[4]) / viewport.width);
    const y = clamp(1 - (Number(transform[5]) + height) / viewport.height);
    return [{ text, x, y, width: clamp(width / viewport.width, 0.001, 1 - x), height: clamp(height / viewport.height, 0.001, 1 - y) }];
  }).sort((left, right) => left.y - right.y || left.x - right.x);
  const regions = lines.map((line, index) => ({
    id: `page-${pageNumber}-line-${index + 1}`,
    label: line.text,
    text: line.text,
    areaNames: normalize(line.text).includes('north lot') ? ['North Lot'] : [],
    x: line.x,
    y: line.y,
    width: line.width,
    height: line.height,
    confidence: 1,
    source: 'embedded_text',
  }));
  pages.push({
    pageNumber,
    sheetNumber: detectSheetNumber(regions),
    title: regions[0]?.text?.slice(0, 160) || null,
    text: regions.map(region => region.text).join('\n') || null,
    regions,
  });
}

await pdf.cleanup();
process.stdout.write(JSON.stringify({ pages }));

function detectSheetNumber(regions) {
  return regions.flatMap(region => {
    const match = region.text.match(/\b(?:sheet(?:\s*(?:no\.?|number))?\s*[:#-]?\s*)?([A-Z]{1,3}[-.]?\d{2,4}(?:\.\d{1,2})?)\b/i);
    if (!match) return [];
    const score = Number(/\bsheet\b/i.test(region.text)) * 4 + Number(region.x >= 0.55 && region.y >= 0.55) * 2 + region.x + region.y;
    return [{ value: match[1].toUpperCase(), score }];
  }).sort((left, right) => right.score - left.score)[0]?.value || null;
}

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function clamp(value, minimum = 0, maximum = 1) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}
