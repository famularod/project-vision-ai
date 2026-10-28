import { readReportImageHeaderInfo, readReportImageHeaderSize } from '../../services/ReportImageHeader';
import fixtures from '../fixtures/b69-jpeg-orientation.json';

const be16 = (n: number) => [n >> 8, n & 255];
const segment = (marker: number, body: number[]) => [255, marker, ...be16(body.length + 2), ...body];
const frame = (w: number, h: number) => segment(192, [8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const ascii = (s: string) => Array.from(s, c => c.charCodeAt(0));
const source = (bytes: Uint8Array) => ({ read: (offset: number, length: number) => bytes.subarray(offset, offset + length) });

it.each(fixtures.cases.filter(sample => sample.kind === 'long' || sample.kind === 'xmp'))('display uncertainty preserves the encoded pixel budget: $name', sample => {
  const bytes = Uint8Array.from(Buffer.from(sample.base64, 'base64'));
  expect(readReportImageHeaderInfo('jpeg', source(bytes))).toEqual({ width: 7, height: 5, displaySizeKnown: false });
  expect(readReportImageHeaderSize('jpeg', source(bytes))).toBeNull();
});

it('conflicting frames preserve the largest pixel budget rather than the first small frame', () => {
  const bytes = Uint8Array.from([255, 216, ...frame(7, 5), ...frame(20000, 20000), 255, 218]);
  expect(readReportImageHeaderInfo('jpeg', source(bytes))).toEqual({ width: 20000, height: 20000, displaySizeKnown: false });
});

it('EXIF payload reads have a whole-JPEG bound, while a later huge frame still reaches the guard', () => {
  const block = segment(225, [...ascii('Exif\0\0'), ...new Array(60000).fill(0)]);
  const bytes = Uint8Array.from([255, 216, ...Array.from({ length: 8 }, () => block).flat(), ...frame(20000, 20000), 255, 218]);
  let read = 0;
  const input = { read(offset: number, length: number) { const chunk = bytes.subarray(offset, offset + length); read += chunk.length; return chunk; } };
  expect(readReportImageHeaderInfo('jpeg', input)).toEqual({ width: 20000, height: 20000, displaySizeKnown: false });
  expect(read).toBeLessThan(262144 + 4096);
});

it('XMP-looking text inside a JPEG comment does not become orientation metadata', () => {
  const bytes = Uint8Array.from([255, 216, ...segment(254, ascii('http://ns.adobe.com/xap/1.0/ tiff:Orientation="6"')), ...frame(7, 5), 255, 218]);
  expect(readReportImageHeaderInfo('jpeg', source(bytes))).toEqual({ width: 7, height: 5, displaySizeKnown: true });
});

it('bounded marker exhaustion retains a known frame budget without asserting a display shape', () => {
  const bytes = Uint8Array.from([255, 216, ...frame(20000, 20000), ...new Array(5000).fill(255)]);
  expect(readReportImageHeaderInfo('jpeg', source(bytes))).toEqual({ width: 20000, height: 20000, displaySizeKnown: false });
});
