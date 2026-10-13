/**
 * Review pass 1, L6 and L7: the Word report learns a picture's size from the
 * first bytes of its file (services/ReportImageHeader), so that a photo that
 * needs no work is never opened and a scan that is too large is refused
 * before the phone's image tool loads it.
 *
 * The reader is run on real files (tests/fixtures/report-image-header-samples:
 * written by Apple's encoder, and checked against what Apple's decoder reads
 * from them), and on headers built here byte by byte for the shapes a small
 * sample cannot show: a large scan, a photo with a thumbnail inside it, WebP.
 */
import { toByteArray } from 'base64-js';
import {
  readReportImageHeaderSize,
  type ReportImageBytes,
} from '../../services/ReportImageHeader';
import { detectReportImageSignature, REPORT_IMAGE_SIGNATURE_BYTES } from '../../services/ReportWordImageFormat';
import { REPORT_IMAGE_HEADER_SAMPLES } from '../fixtures/report-image-header-samples';

/** A file held in memory that also counts how much of itself was read. */
function fileOf(bytes: Uint8Array) {
  const reads: number[] = [];
  const source: ReportImageBytes = {
    read(offset, length) {
      const chunk = bytes.subarray(offset, offset + length);
      reads.push(chunk.length);
      return chunk;
    },
  };
  return { source, reads, bytesRead: () => reads.reduce((sum, length) => sum + length, 0) };
}

const sizeOf = (bytes: Uint8Array) => readReportImageHeaderSize(
  detectReportImageSignature(bytes.subarray(0, REPORT_IMAGE_SIGNATURE_BYTES)),
  fileOf(bytes).source,
);

const ascii = (value: string) => Array.from(value, character => character.charCodeAt(0));
const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const be32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const le16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const le24 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
const le32 = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
const segment = (marker: number, body: readonly number[]) => [0xff, marker, ...be16(body.length + 2), ...body];
const frame = (marker: number, width: number, height: number) =>
  segment(marker, [8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const jpeg = (...parts: readonly (readonly number[])[]) => Uint8Array.from([0xff, 0xd8, ...parts.flat()]);
const JFIF = segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
/** An EXIF block naming an orientation, little-endian, as a phone camera writes it. */
const exif = (orientation: number, extra: readonly number[] = []) => segment(0xe1, [
  ...ascii('Exif\0\0'), 0x49, 0x49, 0x2a, 0x00, ...le32(8),
  ...le16(1), ...le16(274), ...le16(3), ...le32(1), ...le16(orientation), 0, 0, ...le32(0),
  ...extra,
]);

describe('the header reader agrees with Apple\'s decoder on real files', () => {
  it.each(Object.entries(REPORT_IMAGE_HEADER_SAMPLES))('%s', (name, sample) => {
    const bytes = toByteArray(sample.base64);
    const { storedWidth, storedHeight, orientation } = sample.apple;
    const onItsSide = orientation !== null && orientation >= 5;
    const shown = onItsSide
      ? { width: storedHeight, height: storedWidth }
      : { width: storedWidth, height: storedHeight };
    const expected = name === 'heic' || name === 'pngOnItsSide' ? null : shown;
    expect(sizeOf(bytes)).toEqual(expected);
  });

  it('a picture stored on its side is given as it is shown: 5 wide and 7 high, not 7 by 5', () => {
    expect(sizeOf(toByteArray(REPORT_IMAGE_HEADER_SAMPLES.jpegOnItsSide.base64))).toEqual({ width: 5, height: 7 });
    expect(sizeOf(toByteArray(REPORT_IMAGE_HEADER_SAMPLES.jpegOnItsOtherSide.base64))).toEqual({ width: 5, height: 7 });
    expect(sizeOf(toByteArray(REPORT_IMAGE_HEADER_SAMPLES.tiffOnItsSide.base64))).toEqual({ width: 5, height: 7 });
    // Upside down is not on its side.
    expect(sizeOf(toByteArray(REPORT_IMAGE_HEADER_SAMPLES.jpegUpsideDown.base64))).toEqual({ width: 7, height: 5 });
  });

  it('the types it does not read are left to the device: HEIC, and a PNG that says it is stored turned', () => {
    expect(sizeOf(toByteArray(REPORT_IMAGE_HEADER_SAMPLES.heic.base64))).toBeNull();
    expect(sizeOf(toByteArray(REPORT_IMAGE_HEADER_SAMPLES.pngOnItsSide.base64))).toBeNull();
  });

  it('only a small part of each file is read', () => {
    for (const sample of Object.values(REPORT_IMAGE_HEADER_SAMPLES)) {
      const bytes = toByteArray(sample.base64);
      const file = fileOf(bytes);
      readReportImageHeaderSize(detectReportImageSignature(bytes.subarray(0, REPORT_IMAGE_SIGNATURE_BYTES)), file.source);
      expect(file.bytesRead()).toBeLessThan(700);
    }
  });
});

describe('JPEG headers built by hand', () => {
  it('a 12-megapixel photo and a 276-megapixel scan', () => {
    expect(sizeOf(jpeg(JFIF, frame(0xc0, 4032, 3024)))).toEqual({ width: 4032, height: 3024 });
    expect(sizeOf(jpeg(JFIF, frame(0xc2, 19_200, 14_400)))).toEqual({ width: 19_200, height: 14_400 });
  });

  it('a phone photo held upright: stored 4032 x 3024 on its side, shown 3024 x 4032', () => {
    expect(sizeOf(jpeg(exif(6), frame(0xc0, 4032, 3024)))).toEqual({ width: 3024, height: 4032 });
  });

  it('the small preview picture inside the EXIF block is not mistaken for the photo', () => {
    // The preview is a whole JPEG of its own, 160 x 120, inside the block.
    const preview = [0xff, 0xd8, ...frame(0xc0, 160, 120), 0xff, 0xd9];
    expect(sizeOf(jpeg(exif(1, preview), frame(0xc0, 4032, 3024)))).toEqual({ width: 4032, height: 3024 });
  });

  it('blocks before the size are stepped over without being read: 60 KB of them cost a few bytes each', () => {
    const colourProfile = segment(0xe2, new Array(60_000).fill(7));
    const bytes = jpeg(JFIF, colourProfile, segment(0xdb, new Array(65).fill(1)), frame(0xc0, 800, 600));
    const file = fileOf(bytes);
    expect(readReportImageHeaderSize('jpeg', file.source)).toEqual({ width: 800, height: 600 });
    expect(file.bytesRead()).toBeLessThan(40);
  });

  it.each([
    ['ends before the size', jpeg(JFIF)],
    ['only its first four bytes', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])],
    ['the picture data starts with no size given', jpeg(JFIF, [0xff, 0xda, 0, 2])],
    ['a size of nothing', jpeg(JFIF, frame(0xc0, 0, 600))],
    ['a block whose length is impossible', jpeg([0xff, 0xe0, 0, 1], frame(0xc0, 800, 600))],
    ['not a marker where one must be', jpeg([0x12, 0x34, 0x56, 0x78])],
    ['an endless run of fill bytes', Uint8Array.from([0xff, 0xd8, ...new Array(5000).fill(0xff)])],
  ])('a JPEG with %s has no size here (the device is asked instead)', (_name, bytes) => {
    expect(sizeOf(bytes)).toBeNull();
  });
});

describe('the other types, built by hand', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = (width: number, height: number) =>
    Uint8Array.from([...PNG, ...be32(13), ...ascii('IHDR'), ...be32(width), ...be32(height), 8, 6, 0, 0, 0]);

  it('a PNG scan of 19,200 x 14,400, and one wider than 65,535', () => {
    expect(sizeOf(png(19_200, 14_400))).toEqual({ width: 19_200, height: 14_400 });
    expect(sizeOf(png(70_000, 3000))).toEqual({ width: 70_000, height: 3000 });
    expect(sizeOf(Uint8Array.from([...PNG, ...be32(13), ...ascii('IHDR'), 0, 0]))).toBeNull();
  });

  it('WebP in its three forms', () => {
    const riff = (kind: string, payload: readonly number[]) => Uint8Array.from([
      ...ascii('RIFF'), ...le32(4 + 8 + payload.length), ...ascii('WEBP'), ...ascii(kind), ...le32(payload.length), ...payload,
    ]);
    expect(sizeOf(riff('VP8 ', [0x10, 0, 0, 0x9d, 0x01, 0x2a, ...le16(2000), ...le16(1500)])))
      .toEqual({ width: 2000, height: 1500 });
    // Lossless: 14 bits of width less one, then 14 bits of height less one.
    expect(sizeOf(riff('VP8L', [0x2f, ...le32((2000 - 1) | ((1500 - 1) << 14))])))
      .toEqual({ width: 2000, height: 1500 });
    // Extended: three bytes each, less one. A scan can be far larger than the other forms allow.
    expect(sizeOf(riff('VP8X', [0, 0, 0, 0, ...le24(19_200 - 1), ...le24(14_400 - 1)])))
      .toEqual({ width: 19_200, height: 14_400 });
    expect(sizeOf(riff('VP8 ', [0x10, 0, 0, 0, 0, 0, ...le16(2000), ...le16(1500)]))).toBeNull();
  });

  it('a BMP stored top to bottom (a negative height) and the oldest BMP header', () => {
    const bmp = (headerSize: number, rest: readonly number[]) => Uint8Array.from([
      ...ascii('BM'), ...le32(70), 0, 0, 0, 0, ...le32(54), ...le32(headerSize), ...rest,
    ]);
    expect(sizeOf(bmp(40, [...le32(1600), ...le32(-1200 >>> 0), ...le16(1), ...le16(24)])))
      .toEqual({ width: 1600, height: 1200 });
    expect(sizeOf(bmp(12, [...le16(640), ...le16(480), ...le16(1), ...le16(24)])))
      .toEqual({ width: 640, height: 480 });
  });

  it('a little-endian TIFF scan, and BigTIFF, which is not read', () => {
    const tiff = (magic: number, entries: readonly (readonly [number, number, number])[]) => Uint8Array.from([
      0x49, 0x49, ...le16(magic), ...le32(8), ...le16(entries.length),
      ...entries.flatMap(([tag, type, value]) => [...le16(tag), ...le16(type), ...le32(1), ...le32(value)]),
      ...le32(0),
    ]);
    expect(sizeOf(tiff(42, [[256, 4, 19_200], [257, 4, 14_400]]))).toEqual({ width: 19_200, height: 14_400 });
    expect(sizeOf(tiff(42, [[256, 3, 3000], [257, 3, 2000], [274, 3, 8]]))).toEqual({ width: 2000, height: 3000 });
    expect(sizeOf(tiff(42, [[256, 4, 19_200]]))).toBeNull();
    expect(sizeOf(tiff(43, [[256, 4, 19_200], [257, 4, 14_400]]))).toBeNull();
  });

  it('a PDF, an unrecognised file and an empty file have no size', () => {
    expect(sizeOf(Uint8Array.from(ascii('%PDF-1.7\n')))).toBeNull();
    expect(sizeOf(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
    expect(sizeOf(new Uint8Array(0))).toBeNull();
  });

  it('a reader that fails part-way is an unknown size, never an error', () => {
    const failing: ReportImageBytes = { read: () => { throw new Error('The file could not be read.'); } };
    expect(readReportImageHeaderSize('jpeg', failing)).toBeNull();
  });
});
