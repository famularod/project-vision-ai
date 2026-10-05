/**
 * Independent review R07 (Build 229): the phone and iPad Word report labelled
 * any picture it did not recognise by name as image/jpeg and embedded its
 * bytes unchanged, so a WebP or a HEIC went into the document as a ".jpg".
 * The format now comes from the bytes, by one policy shared with the desktop
 * report and the Word builder. These run the real native resolver, the real
 * desktop resolver and the real Word builder with only the platform picture
 * I/O replaced (tests/fixtures/report-word-media-fakes).
 */
import JSZip from 'jszip';
import { Image } from 'react-native';
import { renderPdfExcerpt } from '../../modules/dave-text-recognition';
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';
import {
  buildReportWordBase64,
  summarizeReportWordUnavailableMedia,
  type ReportWordMedia,
  type ReportWordUnavailableMedia,
} from '../../services/ReportWordDocument';
import {
  convertedReportImageMimeType,
  detectReportImageSignature,
  reportImageNotPreparedMessage,
  reportWordDocxImageType,
  reportWordEmbedMimeType,
} from '../../services/ReportWordImageFormat';
import {
  renderNativeReportDrawingPreview,
  resolveNativeReportWordMedia,
} from '../../services/ReportWordMedia.native';
import { detectReportImageFormat, resolveWebReportWordMedia } from '../../services/ReportWordMedia.web';
import type { ProjectUpdate } from '../../types';
import {
  FAKE_SIGNATURES,
  fakeFormatOf,
  fakeImageBytes,
  fakeImageGetSize,
  fakeMedia,
  fakePictureIn,
  installFakeBrowser,
  labelsIn,
  quadrantSheet,
  type FakeImageFormat,
} from '../fixtures/report-word-media-fakes';

jest.mock('expo-file-system', () => require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-image-manipulator', () => require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition', () => ({ renderPdfExcerpt: jest.fn() }));

const NOT_A_PICTURE = 'This file is not a picture the Word report can use. It was left out.';
/** The format each label promises. */
const LABELLED: Readonly<Record<string, FakeImageFormat>> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};
/** The format each file extension inside a .docx promises. */
const EXTENSION: Readonly<Record<string, FakeImageFormat>> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', bmp: 'bmp' };

type Declared = { mimeType?: string; fileName?: string };
type Source = Declared & { id: string; format: FakeImageFormat | 'empty' };

const localUri = (source: Source) => `file:///documents/photos/${source.id}-${source.fileName || 'photo'}`;
const cloudUrl = (source: Source) => `https://cloud.example.test/project-photos/${source.id}`;

/** Puts the same photo files on the phone and in the cloud, and returns the field update that owns them. */
function storePhotos(sources: readonly Source[]): ProjectUpdate {
  return {
    id: 'update-1',
    projectName: '2321 Compliance Project',
    selectedAreaName: 'North Lot',
    scheduleTaskName: 'PLACE ASPHALT',
    date: '2026-10-01',
    photos: sources.map(source => {
      const bytes = source.format === 'empty'
        ? new Uint8Array()
        : fakeImageBytes(source.format, quadrantSheet(800, 600));
      fakeMedia.files.set(localUri(source), bytes);
      fakeMedia.remote.set(cloudUrl(source), { bytes, contentType: source.mimeType ?? null });
      return {
        id: source.id,
        uri: localUri(source),
        mimeType: source.mimeType,
        fileName: source.fileName,
        caption: `Caption ${source.id}`,
        cloudStoragePath: source.id,
      };
    }),
  } as unknown as ProjectUpdate;
}

const nativePhotos = (sources: readonly Source[]) => resolveNativeReportWordMedia({
  updates: [storePhotos(sources)],
  reportPhotoIds: sources.map(source => source.id),
  drawingReferences: [],
});

const desktopPhotos = (sources: readonly Source[]) => resolveWebReportWordMedia({
  updates: [storePhotos(sources)],
  reportPhotoIds: sources.map(source => source.id),
  drawingReferences: [],
  getArtifactUrl: async (_bucket, path) => `https://cloud.example.test/project-photos/${path}`,
});

function drawing(format: FakeImageFormat, declared: Declared): ReportDrawingReference {
  const uri = `file:///documents/project-documents/${declared.fileName}`;
  fakeMedia.files.set(uri, fakeImageBytes(format, quadrantSheet(4000, 3000)));
  const citation = { documentId: 'site-plan', label: 'Site Plan · Rev 2 · Sheet C1.0' };
  return {
    id: 'ref-1',
    projectName: '2321 Compliance Project',
    areaName: 'North Lot',
    citation,
    excerpt: {
      document: { id: 'site-plan', name: 'Site Plan', originalFileName: declared.fileName, mimeType: declared.mimeType, uri },
      pageNumber: 1,
      region: { x: 0.6, y: 0.1, width: 0.3, height: 0.3 },
      citation,
    },
  } as unknown as ReportDrawingReference;
}

const nativeDrawing = (reference: ReportDrawingReference) => resolveNativeReportWordMedia({
  updates: [],
  reportPhotoIds: [],
  drawingReferences: [reference],
});

/** What the native PDF renderer hands back: a file in the given format. */
function pdfRendererWrites(format: FakeImageFormat) {
  jest.mocked(renderPdfExcerpt).mockImplementation(async () => {
    const uri = `file:///tmp/vitruvius-drawing-${fakeMedia.nextId + 1}.jpg`;
    fakeMedia.files.set(uri, fakeImageBytes(format, quadrantSheet(800, 600)));
    return { uri, width: 800, height: 600 };
  });
}

/** Every embedded image must be the format its label says. */
function expectLabelsMatchBytes(media: readonly ReportWordMedia[]) {
  for (const item of media) {
    expect(LABELLED[item.mimeType]).toBeDefined();
    expect({ id: item.id, bytes: fakeFormatOf(item.data) }).toEqual({ id: item.id, bytes: LABELLED[item.mimeType] });
  }
}

/** Opens a generated .docx and returns each embedded media file with the format its bytes really are. */
async function docxMedia(media: readonly ReportWordMedia[], unavailableMedia: readonly ReportWordUnavailableMedia[] = []) {
  const base64 = await buildReportWordBase64({
    title: 'Project Status Report',
    body: 'CURRENT WORK\n- 2321 Compliance Project — PLACE ASPHALT (North Lot): Paving is in progress.',
    generatedAt: '2026-10-01T12:00:00.000Z',
    media,
    unavailableMedia,
  });
  const archive = await JSZip.loadAsync(Buffer.from(base64, 'base64'));
  const names = Object.keys(archive.files)
    .filter(name => name.startsWith('word/media/') && !archive.files[name].dir);
  const files = await Promise.all(names.map(async name => ({
    extension: name.slice(name.lastIndexOf('.') + 1),
    bytes: fakeFormatOf(await archive.file(name)!.async('uint8array')),
  })));
  return {
    files,
    documentXml: await archive.file('word/document.xml')!.async('string'),
    contentTypes: await archive.file('[Content_Types].xml')!.async('string'),
  };
}

let restoreBrowser: () => void = () => undefined;
beforeEach(() => {
  fakeMedia.reset();
  restoreBrowser = installFakeBrowser();
  jest.spyOn(Image, 'getSize').mockImplementation(fakeImageGetSize as never);
});
afterEach(() => {
  restoreBrowser();
  jest.restoreAllMocks();
});

describe('the shared Word image format policy', () => {
  it.each<[FakeImageFormat, string]>([
    ['jpeg', 'jpeg'], ['png', 'png'], ['gif', 'gif'], ['bmp', 'bmp'], ['webp', 'webp'],
    ['heic', 'heic'], ['tiff', 'tiff'], ['pdf', 'pdf'], ['avif', 'unknown'], ['unknown', 'unknown'],
  ])('reads %s bytes as %s from the signature alone', (format, expected) => {
    expect(detectReportImageSignature(Uint8Array.from(FAKE_SIGNATURES[format]))).toBe(expected);
  });

  it('recognises the other real signatures and refuses look-alikes', () => {
    const text = (value: string) => Uint8Array.from(value, character => character.charCodeAt(0));
    expect(detectReportImageSignature(text('GIF87a'))).toBe('gif');
    expect(detectReportImageSignature(Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]))).toBe('tiff');
    expect(detectReportImageSignature(Uint8Array.from([0, 0, 0, 0x18, ...text('ftypmif1'), 0, 0, 0, 0, ...text('mif1heic')]))).toBe('heic');
    // Text that happens to start "BM", a RIFF that is a sound file, a video.
    expect(detectReportImageSignature(text('BMW delivery ticket for the north lot'))).toBe('unknown');
    expect(detectReportImageSignature(text('RIFF$\u0000\u0000\u0000WAVEfmt '))).toBe('unknown');
    expect(detectReportImageSignature(Uint8Array.from([0, 0, 0, 0x18, ...text('ftypisom'), 0, 0, 2, 0, ...text('isomiso2')]))).toBe('unknown');
    expect(detectReportImageSignature(new Uint8Array())).toBe('unknown');
    expect(detectReportImageSignature(Uint8Array.from([0xff, 0xd8]))).toBe('unknown');
  });

  it('embeds only what the Word builder can declare, and converts the rest', () => {
    expect((['jpeg', 'png', 'gif', 'bmp'] as const).map(reportWordEmbedMimeType))
      .toEqual(['image/jpeg', 'image/png', 'image/gif', 'image/bmp']);
    expect((['webp', 'heic', 'tiff', 'pdf', 'unknown'] as const).map(reportWordEmbedMimeType))
      .toEqual([null, null, null, null, null]);
    expect((['jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'tiff', 'pdf', 'unknown'] as const)
      .map(format => reportWordDocxImageType(Uint8Array.from(FAKE_SIGNATURES[format]))))
      .toEqual(['jpg', 'png', 'gif', 'bmp', null, null, null, null, null]);
  });

  it('accepts a converted picture only when it really is a JPEG or a PNG', () => {
    expect(convertedReportImageMimeType(Uint8Array.from(FAKE_SIGNATURES.jpeg))).toBe('image/jpeg');
    expect(convertedReportImageMimeType(Uint8Array.from(FAKE_SIGNATURES.png))).toBe('image/png');
    for (const format of ['gif', 'bmp', 'webp', 'heic', 'tiff', 'pdf', 'unknown'] as const) {
      expect(() => convertedReportImageMimeType(Uint8Array.from(FAKE_SIGNATURES[format]))).toThrow('not a JPEG or a PNG');
    }
  });

  it('is what the desktop detector reads, with the declared type only a hint for unrecognised bytes', () => {
    for (const format of ['jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'tiff', 'pdf'] as const) {
      const bytes = Uint8Array.from(FAKE_SIGNATURES[format]);
      expect(detectReportImageFormat(bytes, 'image/jpeg')).toBe(detectReportImageSignature(bytes));
    }
    expect(detectReportImageFormat(Uint8Array.from(FAKE_SIGNATURES.unknown), 'image/heic')).toBe('heic');
    expect(detectReportImageFormat(Uint8Array.from(FAKE_SIGNATURES.unknown), null)).toBe('unknown');
  });

  it('words a failure so the summary does not call a WebP or a drawing an iPhone photo', () => {
    const reasons = (['webp', 'tiff', 'unknown'] as const).map(reportImageNotPreparedMessage);
    expect(reasons).toEqual([
      'The WebP image could not be prepared for the Word report.',
      'The TIFF image could not be prepared for the Word report.',
      NOT_A_PICTURE,
    ]);
    expect(summarizeReportWordUnavailableMedia(reasons.map((reason, index) => ({
      id: String(index), kind: 'photo', label: `Photo ${index + 1}`, reason,
    })))).toBe('3 report source images could not be prepared.');
    expect(summarizeReportWordUnavailableMedia([{
      id: 'heic', kind: 'photo', label: 'Photo 1', reason: reportImageNotPreparedMessage('heic'),
    }])).toBe('1 iPhone photo could not be converted for Word.');
  });
});

describe('a photo in the phone and iPad Word report', () => {
  it.each<[string, FakeImageFormat, Declared, string]>([
    ['a JPEG', 'jpeg', { mimeType: 'image/jpeg', fileName: 'a.jpg' }, 'image/jpeg'],
    ['a PNG', 'png', { mimeType: 'image/png', fileName: 'a.png' }, 'image/png'],
    ['a GIF', 'gif', { mimeType: 'image/gif', fileName: 'a.gif' }, 'image/gif'],
    ['a BMP', 'bmp', { mimeType: 'image/bmp', fileName: 'a.bmp' }, 'image/bmp'],
    ['a PNG stored as a JPEG', 'png', { mimeType: 'image/jpeg', fileName: 'a.jpg' }, 'image/png'],
    ['a JPEG stored as a PNG', 'jpeg', { mimeType: 'image/png', fileName: 'a.png' }, 'image/jpeg'],
    ['a GIF stored with no type or extension', 'gif', {}, 'image/gif'],
  ])('embeds %s as it is, labelled by its bytes', async (_name, format, declared, mimeType) => {
    const result = await nativePhotos([{ id: 'photo-1', format, ...declared }]);
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media).toHaveLength(1);
    expect(result.media[0]).toMatchObject({ mimeType, width: 800, height: 600 });
    expect(result.media[0].data).toBe(fakeMedia.files.get(localUri({ id: 'photo-1', format, ...declared })));
    expectLabelsMatchBytes(result.media);
    // Nothing was re-encoded.
    expect(fakeMedia.deviceOpened).toEqual([]);
  });

  it.each<[string, FakeImageFormat, Declared]>([
    ['a HEIC', 'heic', { mimeType: 'image/heic', fileName: 'a.heic' }],
    ['a HEIC stored as a JPEG', 'heic', { mimeType: 'image/jpeg', fileName: 'a.jpg' }],
    ['a WebP', 'webp', { mimeType: 'image/webp', fileName: 'a.webp' }],
    ['a WebP stored as a JPEG', 'webp', { mimeType: 'image/jpeg', fileName: 'a.jpg' }],
    ['a WebP stored with no type or extension', 'webp', {}],
    ['a TIFF', 'tiff', { mimeType: 'image/tiff', fileName: 'a.tif' }],
    ['a picture type the policy does not name but the phone can open', 'avif', { mimeType: 'image/avif', fileName: 'a.avif' }],
  ])('converts %s to a real JPEG instead of embedding it under a JPEG label', async (_name, format, declared) => {
    const source = { id: 'photo-1', format, ...declared };
    const result = await nativePhotos([source]);
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media).toHaveLength(1);
    expect(result.media[0]).toMatchObject({ mimeType: 'image/jpeg', width: 800, height: 600 });
    expect(fakeFormatOf(result.media[0].data)).toBe('jpeg');
    expect(result.media[0].data).not.toBe(fakeMedia.files.get(localUri(source)));
    expect(labelsIn(fakePictureIn(result.media[0].data)!)).toBe('ABCD');
    // The converted copy is removed; the original stays.
    expect([...fakeMedia.files.keys()]).toEqual([localUri(source)]);
  });

  it.each<[string, Source['format'], Declared, string]>([
    ['unknown bytes stored as a JPEG', 'unknown', { mimeType: 'image/jpeg', fileName: 'a.jpg' }, NOT_A_PICTURE],
    ['a PDF stored as a JPEG', 'pdf', { mimeType: 'image/jpeg', fileName: 'a.jpg' }, NOT_A_PICTURE],
    ['an empty file', 'empty', { mimeType: 'image/jpeg', fileName: 'a.jpg' }, NOT_A_PICTURE],
  ])('lists %s as unavailable and embeds nothing', async (_name, format, declared, reason) => {
    const result = await nativePhotos([{ id: 'photo-1', format, ...declared }]);
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia).toEqual([{
      id: 'photo-1',
      kind: 'photo',
      label: 'Photo 1 — Caption photo-1',
      reason,
    }]);
  });

  it('lists a picture as unavailable when the conversion does not produce a JPEG or a PNG', async () => {
    fakeMedia.deviceWrites = 'webp';
    const result = await nativePhotos([{ id: 'photo-1', format: 'tiff', mimeType: 'image/tiff', fileName: 'a.tif' }]);
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia.map(item => item.reason))
      .toEqual(['The TIFF image could not be prepared for the Word report.']);
  });

  it('keeps the existing iPhone-photo wording when a HEIC cannot be converted', async () => {
    fakeMedia.deviceWrites = 'heic';
    const result = await nativePhotos([{ id: 'photo-1', format: 'heic', mimeType: 'image/jpeg', fileName: 'a.jpg' }]);
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia[0].reason)
      .toMatch(/^The iPhone photo could not be prepared for the Word report\. /);
    expect(summarizeReportWordUnavailableMedia(result.unavailableMedia))
      .toBe('1 iPhone photo could not be converted for Word.');
  });

  it('labels a converted picture PNG when a PNG is what was written', async () => {
    fakeMedia.deviceWrites = 'png';
    const result = await nativePhotos([{ id: 'photo-1', format: 'webp', mimeType: 'image/jpeg', fileName: 'a.jpg' }]);
    expect(result.media[0].mimeType).toBe('image/png');
    expectLabelsMatchBytes(result.media);
  });

  it('keeps photo numbers when one in the middle is unavailable', async () => {
    const result = await nativePhotos([
      { id: 'photo-1', format: 'jpeg', mimeType: 'image/jpeg', fileName: 'a.jpg' },
      { id: 'photo-2', format: 'unknown', mimeType: 'image/jpeg', fileName: 'b.jpg' },
      { id: 'photo-3', format: 'webp', mimeType: 'image/jpeg', fileName: 'c.jpg' },
    ]);
    expect(result.media.map(item => [item.id, item.displayNumber, item.mimeType]))
      .toEqual([['photo-1', 1, 'image/jpeg'], ['photo-3', 3, 'image/jpeg']]);
    expect(result.unavailableMedia.map(item => item.label)).toEqual(['Photo 2 — Caption photo-2']);
    expectLabelsMatchBytes(result.media);
  });
});

describe('a drawing in the phone and iPad Word report', () => {
  it('renders a PDF as a PDF even when it is stored as a picture', async () => {
    pdfRendererWrites('jpeg');
    const result = await nativeDrawing(drawing('pdf', { mimeType: 'image/jpeg', fileName: 'site-plan.jpg' }));
    expect(result.unavailableMedia).toEqual([]);
    expect(renderPdfExcerpt).toHaveBeenCalledTimes(1);
    expect(fakeMedia.deviceOpened).toEqual([]);
    expectLabelsMatchBytes(result.media);
  });

  it('crops a picture as a picture even when it is stored as a PDF', async () => {
    const result = await nativeDrawing(drawing('png', { mimeType: 'application/pdf', fileName: 'site-plan.pdf' }));
    expect(result.unavailableMedia).toEqual([]);
    expect(renderPdfExcerpt).not.toHaveBeenCalled();
    expect(labelsIn(fakePictureIn(result.media[0].data)!)).toBe('B');
    expect(result.media[0].mimeType).toBe('image/jpeg');
    expectLabelsMatchBytes(result.media);
  });

  it.each<FakeImageFormat>(['webp', 'heic', 'tiff'])('crops a %s drawing and embeds a real JPEG', async format => {
    const result = await nativeDrawing(drawing(format, { mimeType: 'image/jpeg', fileName: 'site-plan.jpg' }));
    expect(result.unavailableMedia).toEqual([]);
    expect(labelsIn(fakePictureIn(result.media[0].data)!)).toBe('B');
    expectLabelsMatchBytes(result.media);
  });

  it('asks the stored type only when the bytes are none it recognises', async () => {
    pdfRendererWrites('jpeg');
    const asPdf = await nativeDrawing(drawing('unknown', { mimeType: 'application/pdf', fileName: 'site-plan.pdf' }));
    expect(renderPdfExcerpt).toHaveBeenCalledTimes(1);
    expect(asPdf.media).toHaveLength(1);

    const asPicture = await nativeDrawing(drawing('unknown', { mimeType: 'image/jpeg', fileName: 'site-plan.jpg' }));
    expect(renderPdfExcerpt).toHaveBeenCalledTimes(1);
    expect(asPicture.media).toEqual([]);
    expect(asPicture.unavailableMedia.map(item => item.reason)).toEqual([NOT_A_PICTURE]);
  });

  it('labels a rendered PDF excerpt by reading it back, and refuses one that is not a JPEG or a PNG', async () => {
    pdfRendererWrites('png');
    const png = await nativeDrawing(drawing('pdf', { mimeType: 'application/pdf', fileName: 'site-plan.pdf' }));
    expect(png.media[0].mimeType).toBe('image/png');
    expectLabelsMatchBytes(png.media);

    pdfRendererWrites('unknown');
    const refused = await nativeDrawing(drawing('pdf', { mimeType: 'application/pdf', fileName: 'site-plan.pdf' }));
    expect(refused.media).toEqual([]);
    expect(refused.unavailableMedia.map(item => item.reason))
      .toEqual(['The prepared image is not a JPEG or a PNG, so it was left out.']);
    expect(summarizeReportWordUnavailableMedia(refused.unavailableMedia))
      .toBe('1 report source image could not be prepared.');
  });

  it('refuses a cropped excerpt that was not written as a JPEG or a PNG', async () => {
    fakeMedia.deviceWrites = 'webp';
    const result = await nativeDrawing(drawing('jpeg', { mimeType: 'image/jpeg', fileName: 'site-plan.jpg' }));
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia.map(item => item.reason))
      .toEqual(['The prepared image is not a JPEG or a PNG, so it was left out.']);
  });

  it('chooses the on-screen preview the same way', async () => {
    pdfRendererWrites('jpeg');
    await renderNativeReportDrawingPreview(drawing('pdf', { mimeType: 'image/jpeg', fileName: 'site-plan.jpg' }));
    expect(renderPdfExcerpt).toHaveBeenCalledTimes(1);
    const previewUri = await renderNativeReportDrawingPreview(
      drawing('jpeg', { mimeType: 'application/pdf', fileName: 'site-plan.pdf' }),
    );
    expect(renderPdfExcerpt).toHaveBeenCalledTimes(1);
    expect(labelsIn(fakePictureIn(fakeMedia.files.get(previewUri)!)!)).toBe('B');
  });
});

const MIXED: readonly Source[] = [
  { id: 'jpeg', format: 'jpeg', mimeType: 'image/jpeg', fileName: 'a.jpg' },
  { id: 'png-as-jpeg', format: 'png', mimeType: 'image/jpeg', fileName: 'b.jpg' },
  { id: 'heic-as-jpeg', format: 'heic', mimeType: 'image/jpeg', fileName: 'c.jpg' },
  { id: 'webp-as-jpeg', format: 'webp', mimeType: 'image/jpeg', fileName: 'd.jpg' },
  { id: 'tiff', format: 'tiff', mimeType: 'image/tiff', fileName: 'e.tif' },
  { id: 'gif', format: 'gif', mimeType: 'image/gif', fileName: 'f.gif' },
  { id: 'bmp', format: 'bmp', mimeType: 'image/bmp', fileName: 'g.bmp' },
  { id: 'unknown-as-jpeg', format: 'unknown', mimeType: 'image/jpeg', fileName: 'h.jpg' },
];

describe('the media inside the generated Word document', () => {
  it('matches its declared type for every picture the phone and iPad report embeds', async () => {
    const resolved = await nativePhotos(MIXED);
    expect(resolved.media.map(item => [item.id, item.mimeType])).toEqual([
      ['jpeg', 'image/jpeg'],
      ['png-as-jpeg', 'image/png'],
      ['heic-as-jpeg', 'image/jpeg'],
      ['webp-as-jpeg', 'image/jpeg'],
      ['tiff', 'image/jpeg'],
      ['gif', 'image/gif'],
      ['bmp', 'image/bmp'],
    ]);
    expectLabelsMatchBytes(resolved.media);

    const docx = await docxMedia(resolved.media, resolved.unavailableMedia);
    expect(docx.files).toHaveLength(7);
    for (const file of docx.files) {
      expect(file).toEqual({ extension: file.extension, bytes: EXTENSION[file.extension] });
    }
    expect(docx.files.map(file => file.bytes).sort())
      .toEqual(['bmp', 'gif', 'jpeg', 'jpeg', 'jpeg', 'jpeg', 'png']);
    for (const extension of new Set(docx.files.map(file => file.extension))) {
      expect(docx.contentTypes).toContain(`Extension="${extension}"`);
    }
    expect(docx.documentXml).toContain('Media Requiring Review');
    expect(docx.documentXml).toContain(`Photo 8 — Caption unknown-as-jpeg: ${NOT_A_PICTURE}`);
  });

  it('matches its declared type for every picture the desktop report embeds', async () => {
    // Without the HEIC: the desktop loads its HEIC converter on demand, which jest cannot do.
    const resolved = await desktopPhotos(MIXED.filter(source => source.format !== 'heic'));
    // The desktop draws every picture again, so each one it can open is a JPEG.
    expect(resolved.media.map(item => [item.id, item.mimeType])).toEqual([
      ['jpeg', 'image/jpeg'],
      ['png-as-jpeg', 'image/jpeg'],
      ['webp-as-jpeg', 'image/jpeg'],
      ['gif', 'image/jpeg'],
      ['bmp', 'image/jpeg'],
    ]);
    expectLabelsMatchBytes(resolved.media);
    expect(resolved.unavailableMedia.map(item => [item.id, item.reason])).toEqual([
      ['tiff', 'The TIFF image could not be prepared for the Word report.'],
      ['unknown-as-jpeg', NOT_A_PICTURE],
    ]);

    const docx = await docxMedia(resolved.media, resolved.unavailableMedia);
    expect(docx.files).toHaveLength(5);
    for (const file of docx.files) {
      expect(file).toEqual({ extension: file.extension, bytes: EXTENSION[file.extension] });
    }
  });

  it('is chosen by the Word builder from the bytes, whatever label it is handed', async () => {
    const item = (id: string, format: FakeImageFormat, mimeType: string, displayNumber: number): ReportWordMedia => ({
      id,
      kind: 'photo',
      displayNumber,
      caption: `Caption ${id}`,
      data: fakeImageBytes(format, quadrantSheet(8, 6)),
      mimeType,
      width: 8,
      height: 6,
      projectName: '2321 Compliance Project',
      areaName: 'North Lot',
      linkedTaskName: 'PLACE ASPHALT',
    });
    const docx = await docxMedia([
      item('png-labelled-jpeg', 'png', 'image/jpeg', 1),
      item('webp-labelled-jpeg', 'webp', 'image/jpeg', 2),
      item('jpeg-labelled-webp', 'jpeg', 'image/webp', 3),
    ]);

    expect(docx.files.map(file => `${file.extension}:${file.bytes}`).sort()).toEqual(['jpg:jpeg', 'png:png']);
    // The mislabelled WebP is listed, not dropped, and the report does not point at it.
    expect(docx.documentXml).toContain('Media Requiring Review');
    expect(docx.documentXml).toContain(
      'Photo 2 — Caption webp-labelled-jpeg: The image data is not a JPEG, PNG, GIF or BMP, so Word could not show it. It was left out.',
    );
    expect(docx.documentXml).toContain('Photos 1 and 3 show this work.');
    expect(docx.documentXml).not.toContain('Photos 1, 2, and 3');
  });
});

describe('a photo in the desktop Word report', () => {
  it('draws a WebP again as a real JPEG', async () => {
    const result = await desktopPhotos([{ id: 'photo-1', format: 'webp', mimeType: 'image/jpeg', fileName: 'a.jpg' }]);
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media[0].mimeType).toBe('image/jpeg');
    expectLabelsMatchBytes(result.media);
  });

  it('labels the picture by what the browser wrote, and refuses anything but a JPEG or a PNG', async () => {
    fakeMedia.browserWrites = 'png';
    const png = await desktopPhotos([{ id: 'photo-1', format: 'jpeg', mimeType: 'image/jpeg', fileName: 'a.jpg' }]);
    expect(png.media[0].mimeType).toBe('image/png');
    expectLabelsMatchBytes(png.media);

    fakeMedia.browserWrites = 'webp';
    const refused = await desktopPhotos([{ id: 'photo-2', format: 'jpeg', mimeType: 'image/jpeg', fileName: 'a.jpg' }]);
    expect(refused.media).toEqual([]);
    expect(refused.unavailableMedia.map(item => item.reason))
      .toEqual(['The prepared image is not a JPEG or a PNG, so it was left out.']);
  });
});

describe('the same file on the phone and on the desktop', () => {
  it.each<[string, FakeImageFormat]>([
    ['a JPEG', 'jpeg'], ['a PNG', 'png'], ['a GIF', 'gif'], ['a BMP', 'bmp'],
    ['a WebP', 'webp'], ['an unnamed type both can open', 'avif'],
  ])('is embedded on both, each under a label its bytes match, for %s stored as a JPEG', async (_name, format) => {
    const source: Source = { id: 'photo-1', format, mimeType: 'image/jpeg', fileName: 'a.jpg' };
    const phone = await nativePhotos([source]);
    const web = await desktopPhotos([source]);
    expect(phone.unavailableMedia).toEqual([]);
    expect(web.unavailableMedia).toEqual([]);
    expect(phone.media).toHaveLength(1);
    expect(web.media).toHaveLength(1);
    expectLabelsMatchBytes(phone.media);
    expectLabelsMatchBytes(web.media);
  });

  it.each<[string, FakeImageFormat]>([
    ['unknown bytes', 'unknown'], ['a PDF', 'pdf'],
  ])('is refused on both in the same words, for %s stored as a JPEG', async (_name, format) => {
    const source: Source = { id: 'photo-1', format, mimeType: 'image/jpeg', fileName: 'a.jpg' };
    const phone = await nativePhotos([source]);
    const web = await desktopPhotos([source]);
    expect(phone.media).toEqual([]);
    expect(web.media).toEqual([]);
    expect(phone.unavailableMedia.map(item => item.reason)).toEqual([NOT_A_PICTURE]);
    expect(web.unavailableMedia.map(item => item.reason)).toEqual([NOT_A_PICTURE]);
  });
});
