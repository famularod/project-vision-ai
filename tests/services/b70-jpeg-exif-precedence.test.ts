import { Image } from 'react-native';
import JSZip from 'jszip';
import fixtures from '../fixtures/b70-jpeg-exif-precedence.json';
import { resolveNativeReportWordMedia } from '../../services/ReportWordMedia.native';
import { buildReportWordBase64 } from '../../services/ReportWordDocument';
import { readReportImageHeaderInfo } from '../../services/ReportImageHeader';
import { fakeMedia, fakeImageBytes, fakeImageGetSize, quadrantSheet, expectFakeDeviceLetGoOfEveryPicture } from '../fixtures/report-word-media-fakes';

jest.mock('expo-file-system', () => require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-image-manipulator', () => require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition', () => ({ renderPdfExcerpt: jest.fn() }));
const uri = 'file:///synthetic/b70.jpg';
const raw = (sample: typeof fixtures.cases[number]) => Uint8Array.from(Buffer.from(sample.base64, 'base64'));
const source = (bytes: Uint8Array) => ({ read: (offset: number, length: number) => bytes.subarray(offset, offset + length) });
function store(sample: typeof fixtures.cases[number]) {
  // The only decoder substitute is the observed platform upright picture.
  // Keep every original EXIF byte and its placement; COM registers that picture.
  const registered = fakeImageBytes('jpeg', quadrantSheet(sample.expected.width, sample.expected.height));
  const id = /\|picture-\d+\|/.exec(String.fromCharCode(...registered))![0];
  const bytes = raw(sample);
  const mark = [255, 254, 0, id.length + 2, ...Array.from(id, c => c.charCodeAt(0))];
  const file = Uint8Array.from([...bytes.slice(0, 2), ...mark, ...bytes.slice(2)]);
  fakeMedia.files.set(uri, file);
  return file;
}
beforeEach(() => { fakeMedia.reset(); jest.spyOn(Image, 'getSize').mockImplementation(fakeImageGetSize as never); });
afterEach(() => { jest.restoreAllMocks(); expectFakeDeviceLetGoOfEveryPicture(); });

it.each(fixtures.cases)('native as-is → real DOCX honors observed EXIF precedence: $name', async sample => {
  const bytes = store(sample);
  const result = await resolveNativeReportWordMedia({ updates: [{ id: 'u', projectName: 'Synthetic', photos: [{ id: 'p', uri }] } as never], reportPhotoIds: ['p'], drawingReferences: [] });
  expect(result.unavailableMedia).toEqual([]);
  expect(result.media).toHaveLength(1);
  expect(result.media[0].data).toEqual(bytes);
  expect(fakeMedia.deviceOpened).toEqual([]);
  const zip = await JSZip.loadAsync(Buffer.from(await buildReportWordBase64({ title: 'Precedence', body: 'Photo 1', generatedAt: '2026-10-18T12:00:00Z', media: result.media }), 'base64'));
  const xml = await zip.file('word/document.xml')!.async('string');
  const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml)!;
  const ratio = Number(extent[1]) / Number(extent[2]);
  // A single assertion includes the actual native shape and real Word shape;
  // even a failing case reaches and reports the DOCX ratio.
  expect([result.media[0].width, result.media[0].height, Math.round(ratio * 1e6)])
    .toEqual([sample.expected.width, sample.expected.height, Math.round(sample.expected.width / sample.expected.height * 1e6)]);
});

const multiple = fixtures.cases.filter(sample => sample.name.includes('then') || sample.name.includes('before6') || sample.name.includes('beforeempty'));
it.each(multiple)('every multi-EXIF arrangement retains budget without claiming upright authority: $name', sample => {
  expect(readReportImageHeaderInfo('jpeg', source(raw(sample)))).toEqual({ width: 7, height: 5, displaySizeKnown: false });
});

it.each(multiple)('huge multi-EXIF frames stay guarded before any platform decode: $name', async sample => {
  const bytes = raw(sample);
  // Deliberately retain tiny entropy with a huge frame; never decode this file.
  const frame = bytes.findIndex((value, index) => value === 255 && bytes[index + 1] === 192);
  expect(frame).toBeGreaterThan(0);
  bytes[frame + 5] = 0x4e; bytes[frame + 6] = 0x20;
  bytes[frame + 7] = 0x4e; bytes[frame + 8] = 0x20;
  fakeMedia.files.set(uri, bytes);
  const citation = { documentId: 'drawing', label: 'Synthetic' };
  const result = await resolveNativeReportWordMedia({ updates: [], reportPhotoIds: [], drawingReferences: [{ id: 'drawing', projectName: 'Synthetic', citation, excerpt: { document: { id: 'drawing', uri, name: 'Synthetic', mimeType: 'image/jpeg' }, pageNumber: 1, region: { x: 0, y: 0, width: 1, height: 1 }, citation } } as never] });
  expect(result.media).toEqual([]);
  expect(result.unavailableMedia).toHaveLength(1);
  expect(fakeMedia.deviceSizeAsked).toEqual([]);
  expect(fakeMedia.deviceOpened).toEqual([]);
  expect(result.unavailableMedia[0].reason).toMatch(/reports 20,000 x 20,000 pixels/);
});
