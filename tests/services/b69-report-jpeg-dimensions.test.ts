import { Image } from 'react-native';
import JSZip from 'jszip';
import fixtures from '../fixtures/b69-jpeg-orientation.json';
import { resolveNativeReportWordMedia } from '../../services/ReportWordMedia.native';
import { buildReportWordBase64 } from '../../services/ReportWordDocument';
import type { ProjectUpdate } from '../../types';
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';
import { fakeMedia, fakeImageBytes, fakeImageGetSize, quadrantSheet, expectFakeDeviceLetGoOfEveryPicture } from '../fixtures/report-word-media-fakes';

jest.mock('expo-file-system', () => require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-image-manipulator', () => require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition', () => ({ renderPdfExcerpt: jest.fn() }));

const uri = 'file:///synthetic/b69.jpg';
type Fixture = typeof fixtures.cases[number];
function store(sample: Fixture) {
  const bytes = Uint8Array.from(Buffer.from(sample.base64, 'base64'));
  if (sample.kind === 'huge') { fakeMedia.files.set(uri, bytes); return bytes; }
  // Only the platform decoder is replaced: the real handmade JPEG/header
  // remains in the caller. COM registers the independently specified upright
  // picture with the retained platform fake; no source metadata is rewritten.
  const registered = fakeImageBytes('jpeg', quadrantSheet(sample.expected.width, sample.expected.height));
  const id = /\|(picture-\d+)\|/.exec(String.fromCharCode(...registered))![0];
  const mark = Uint8Array.from([255, 254, 0, id.length + 2, ...Array.from(id, c => c.charCodeAt(0))]);
  const file = Uint8Array.from([...bytes.slice(0, 2), ...mark, ...bytes.slice(2)]);
  fakeMedia.files.set(uri, file);
  return file;
}
function photo() {
  return resolveNativeReportWordMedia({ updates: [{ id: 'update', projectName: 'Synthetic', date: '2026-10-18', photos: [{ id: 'photo', uri, caption: 'Synthetic' }] }] as unknown as ProjectUpdate[], reportPhotoIds: ['photo'], drawingReferences: [] });
}
function drawing() {
  const citation = { documentId: 'drawing', label: 'Synthetic drawing' };
  return resolveNativeReportWordMedia({ updates: [], reportPhotoIds: [], drawingReferences: [{ id: 'drawing', projectName: 'Synthetic', citation, excerpt: { document: { id: 'drawing', uri, name: 'Synthetic', mimeType: 'image/jpeg' }, pageNumber: 1, region: { x: 0, y: 0, width: 1, height: 1 }, citation } }] as unknown as ReportDrawingReference[] });
}
beforeEach(() => { fakeMedia.reset(); jest.spyOn(Image, 'getSize').mockImplementation(fakeImageGetSize as never); });
afterEach(() => { jest.restoreAllMocks(); expectFakeDeviceLetGoOfEveryPicture(); });

it.each(fixtures.cases.filter(sample => sample.kind !== 'huge'))('whole4.35 actual as-is photo and DOCX shape: $name', async sample => {
  const bytes = store(sample);
  const result = await photo();
  expect(result.unavailableMedia).toEqual([]);
  expect(result.media.map(({ width, height }) => ({ width, height }))).toEqual([sample.expected]);
  expect(result.media[0].data).toEqual(bytes);
  expect(fakeMedia.deviceOpened).toEqual([]);
  const zip = await JSZip.loadAsync(Buffer.from(await buildReportWordBase64({ title: 'Synthetic', body: 'Synthetic', generatedAt: '2026-10-18T12:00:00.000Z', media: result.media }), 'base64'));
  const xml = await zip.file('word/document.xml')!.async('string');
  const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml)!;
  expect(Number(extent[1]) / Number(extent[2])).toBeCloseTo(sample.expected.width / sample.expected.height, 3);
});

it.each(fixtures.cases.filter(sample => sample.kind === 'huge'))('whole4.35 huge damaged header is explained without decode or diagnosis: $name', async sample => {
  store(sample);
  const result = await drawing();
  expect(result.media).toEqual([]);
  expect(result.unavailableMedia).toHaveLength(1);
  expect(fakeMedia.deviceOpened).toEqual([]);
  expect(fakeMedia.deviceSizeAsked).toEqual([]);
  expect(result.unavailableMedia[0].reason).toMatch(/(?:reports|states|indicates).*20,000 x 20,000 pixels/i);
  expect(result.unavailableMedia[0].reason).toMatch(/if.*(?:damaged|does not open|will not open)/i);
  expect(result.unavailableMedia[0].reason).not.toMatch(/will be included|is damaged/i);
});

it.each(fixtures.cases.filter(sample => sample.kind !== 'huge'))('retained native conversion uses the decoder upright shape: $name', async sample => {
  store(sample);
  fakeMedia.fileSizes.set(uri, 1_500_001);
  const result = await photo();
  expect(result.unavailableMedia).toEqual([]);
  expect(result.media.map(({ width, height }) => ({ width, height }))).toEqual([sample.expected]);
  expect(fakeMedia.deviceOpened).toEqual([uri]);
});

it.each(fixtures.cases.filter(sample => sample.kind !== 'huge'))('retained native drawing crop uses the decoder upright coordinates: $name', async sample => {
  store(sample);
  const result = await drawing();
  expect(result.unavailableMedia).toEqual([]);
  expect(result.media.map(({ width, height }) => ({ width, height }))).toEqual([sample.expected]);
  expect(fakeMedia.deviceCrops).toEqual([expect.objectContaining({ originX: 0, originY: 0, width: sample.expected.width, height: sample.expected.height })]);
});

const bytesOf = (name: string) => Uint8Array.from(Buffer.from(fixtures.cases.find(sample => sample.name === name)!.base64, 'base64'));
const app1 = (name: string) => {
  const bytes = bytesOf(name);
  const length = (bytes[4] << 8) | bytes[5];
  return bytes.slice(2, length + 4);
};
const withSegment = (bytes: Uint8Array, segment: Uint8Array) => Uint8Array.from([...bytes.slice(0, 2), ...segment, ...bytes.slice(2)]);

it.each(['long-6-le', 'long-6-be', 'xmp-attribute', 'xmp-element', 'xmp-after-frame'])('uncertain %s metadata keeps the huge-frame guard ahead of all decoding', async name => {
  // after-frame supplies the same XMP segment as attribute; its original
  // after-frame placement is already covered by the regular caller cases.
  const segment = app1(name === 'xmp-after-frame' ? 'xmp-attribute' : name);
  const bytes = withSegment(bytesOf('huge-corrupt-jpeg'), segment);
  fakeMedia.files.set(uri, bytes);
  const result = await drawing();
  expect(result.media).toEqual([]);
  expect(result.unavailableMedia).toHaveLength(1);
  expect(fakeMedia.deviceOpened).toEqual([]);
  expect(fakeMedia.deviceSizeAsked).toEqual([]);
});

it.each([{ width: 7, height: 5 }, { width: 5, height: 7 }])('conflicting EXIF and XMP leave platform orientation authority intact: %j', async expected => {
  const sample = { ...fixtures.cases.find(sample => sample.name === 'short-1-le')!, expected };
  const original = store(sample);
  fakeMedia.files.set(uri, withSegment(original, app1('xmp-attribute')));
  const result = await photo();
  expect(fakeMedia.deviceSizeAsked).toEqual([uri]);
  expect(result.media.map(({ width, height }) => ({ width, height }))).toEqual([expected]);
  expect(fakeMedia.deviceOpened).toEqual([]);
});
