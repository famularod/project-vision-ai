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
