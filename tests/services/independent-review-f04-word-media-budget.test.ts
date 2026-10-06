/**
 * Independent review F04 (Build 229), Build 231 E1 item 6: a large Word
 * report on the phone or iPad put every photo in at full size and fetched
 * them all at once; a PDF drawing excerpt had no size limit; a very large
 * drawing scan was opened whatever its size; and the notice that some
 * pictures were left out came after the share sheet. Each picture is now
 * bounded (services/ReportWordMediaLimits), handled one at a time, and the
 * notice is read before sharing.
 *
 * The real phone resolver and the real desktop resolver run with only the
 * platform picture I/O replaced (tests/fixtures/report-word-media-fakes).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Image } from 'react-native';
import { renderPdfExcerpt } from '../../modules/dave-text-recognition';
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';
import {
  oneAtATime,
  renderNativeReportDrawingPreview,
  resolveNativeReportWordMedia,
} from '../../services/ReportWordMedia.native';
import { resolveWebReportWordMedia } from '../../services/ReportWordMedia.web';
import {
  REPORT_DRAWING_SCAN_MAX_PIXELS,
  REPORT_PHOTO_AS_IS_MAX_BYTES,
  REPORT_PICTURE_MAX_HEIGHT,
  REPORT_PICTURE_MAX_WIDTH,
  reportDrawingScanTooLargeMessage,
  reportPictureFit,
} from '../../services/ReportWordMediaLimits';
import type { ProjectUpdate } from '../../types';
import {
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

type Photo = { id: string; format: FakeImageFormat; width: number; height: number; fileBytes?: number };
type Region = { x: number; y: number; width: number; height: number };

const localUri = (photo: Photo) => `file:///documents/photos/${photo.id}`;
const cloudUrl = (photo: Photo) => `https://cloud.example.test/project-photos/${photo.id}`;
const MB = 1_000_000;

/** Puts the same photos on the phone and in the cloud, and returns the field update that owns them. */
function storePhotos(photos: readonly Photo[]): ProjectUpdate {
  return {
    id: 'update-1',
    projectName: '2321 Compliance Project',
    selectedAreaName: 'North Lot',
    scheduleTaskName: 'PLACE ASPHALT',
    date: '2026-10-01',
    photos: photos.map(photo => {
      const bytes = fakeImageBytes(photo.format, quadrantSheet(photo.width, photo.height));
      fakeMedia.files.set(localUri(photo), bytes);
      if (photo.fileBytes) fakeMedia.fileSizes.set(localUri(photo), photo.fileBytes);
      fakeMedia.remote.set(cloudUrl(photo), { bytes, contentType: null });
      return { id: photo.id, uri: localUri(photo), caption: `Caption ${photo.id}`, cloudStoragePath: photo.id };
    }),
  } as unknown as ProjectUpdate;
}

const phonePhotos = (photos: readonly Photo[]) => resolveNativeReportWordMedia({
  updates: [storePhotos(photos)],
  reportPhotoIds: photos.map(photo => photo.id),
  drawingReferences: [],
});

const desktopPhotos = (photos: readonly Photo[]) => resolveWebReportWordMedia({
  updates: [storePhotos(photos)],
  reportPhotoIds: photos.map(photo => photo.id),
  drawingReferences: [],
  getArtifactUrl: async (_bucket, path) => `https://cloud.example.test/project-photos/${path}`,
});

const SHEET_URI = 'file:///documents/project-documents/site-plan';
const TOP_RIGHT: Region = { x: 0.6, y: 0.1, width: 0.3, height: 0.3 };
const WHOLE_SHEET: Region = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 };

function drawing(region: Region, document: Record<string, unknown> = {}): ReportDrawingReference {
  const citation = { documentId: 'site-plan', label: 'Site Plan · Rev 2 · Sheet C1.0' };
  return {
    id: 'ref-1',
    projectName: '2321 Compliance Project',
    areaName: 'North Lot',
    citation,
    excerpt: {
      document: { id: 'site-plan', name: 'Site Plan', originalFileName: 'site-plan.jpg', mimeType: 'image/jpeg', uri: SHEET_URI, ...document },
      pageNumber: 1,
      region,
      citation,
    },
  } as unknown as ReportDrawingReference;
}

const phoneDrawing = (reference: ReportDrawingReference) => resolveNativeReportWordMedia({
  updates: [],
  reportPhotoIds: [],
  drawingReferences: [reference],
});

/** A PDF drawing on the phone whose native renderer hands back an excerpt of the given size. */
function pdfDrawing(region: Region, excerptWidth: number, excerptHeight: number) {
  fakeMedia.files.set(SHEET_URI, fakeImageBytes('pdf'));
  jest.mocked(renderPdfExcerpt).mockImplementation(async () => {
    const uri = `file:///tmp/vitruvius-drawing-${fakeMedia.files.size}.jpg`;
    fakeMedia.files.set(uri, fakeImageBytes('jpeg', quadrantSheet(excerptWidth, excerptHeight)));
    return { uri, width: excerptWidth, height: excerptHeight };
  });
  return drawing(region, { originalFileName: 'site-plan.pdf', mimeType: 'application/pdf' });
}

let restoreBrowser: () => void = () => undefined;
beforeEach(() => {
  fakeMedia.reset();
  restoreBrowser = installFakeBrowser();
  jest.mocked(renderPdfExcerpt).mockReset();
  jest.spyOn(Image, 'getSize').mockImplementation(fakeImageGetSize as never);
});
afterEach(() => {
  restoreBrowser();
  jest.restoreAllMocks();
});

describe('F04: the limits, and why', () => {
  it('a picture is at most 1600 x 1200 px, a photo goes in as it is up to 1.5 MB, a scan is opened up to 160 megapixels', () => {
    expect([REPORT_PICTURE_MAX_WIDTH, REPORT_PICTURE_MAX_HEIGHT]).toEqual([1600, 1200]);
    expect(REPORT_PHOTO_AS_IS_MAX_BYTES).toBe(1_500_000);
    expect(REPORT_DRAWING_SCAN_MAX_PIXELS).toBe(160_000_000);
    // A 36 x 48 in sheet scanned at 300 dpi is still taken; at 400 dpi it is not.
    expect(10_800 * 14_400).toBeLessThanOrEqual(REPORT_DRAWING_SCAN_MAX_PIXELS);
    expect(14_400 * 19_200).toBeGreaterThan(REPORT_DRAWING_SCAN_MAX_PIXELS);
  });

  it.each([
    [4032, 3024, 1600, 1200],
    [3024, 4032, 900, 1200],
    [8000, 1000, 1600, 200],
    [1600, 1200, 1600, 1200],
    [800, 600, 800, 600],
    [5000, 1, 1600, 1],
  ])('a %i x %i picture goes in at %i x %i', (width, height, fitWidth, fitHeight) => {
    expect(reportPictureFit(width, height)).toEqual({ width: fitWidth, height: fitHeight });
  });
});

describe('F04: photos on the phone and iPad', () => {
  it.each([
    ['a 12-megapixel JPEG', { format: 'jpeg', width: 4032, height: 3024, fileBytes: 4 * MB }, 1600, 1200],
    ['a 12-megapixel JPEG whose file is small', { format: 'jpeg', width: 4032, height: 3024, fileBytes: 0.9 * MB }, 1600, 1200],
    ['a portrait JPEG', { format: 'jpeg', width: 3024, height: 4032, fileBytes: 3 * MB }, 900, 1200],
    ['a large PNG screenshot', { format: 'png', width: 2732, height: 2048, fileBytes: 6 * MB }, 1600, 1199],
  ] as const)('%s goes in as a JPEG no larger than 1600 x 1200 (was: as it is, at full size)', async (_name, source, width, height) => {
    const photo = { id: 'photo-1', ...source };
    const result = await phonePhotos([photo]);
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media[0]).toMatchObject({ mimeType: 'image/jpeg', width, height });
    const embedded = result.media[0].data as Uint8Array;
    expect(embedded).not.toBe(fakeMedia.files.get(localUri(photo)));
    expect(fakeFormatOf(embedded)).toBe('jpeg');
    expect(fakePictureIn(embedded)).toMatchObject({ width, height });
    // The whole photo, made smaller: all four quarters are still there.
    expect(labelsIn(fakePictureIn(embedded)!)).toBe('ABCD');
    // Nothing made on the way is left behind.
    expect([...fakeMedia.files.keys()]).toEqual([localUri(photo)]);
  });

  it('a HEIC photo is converted at the bounded size (was: converted at full size)', async () => {
    const result = await phonePhotos([{ id: 'photo-1', format: 'heic', width: 4032, height: 3024, fileBytes: 2 * MB }]);
    expect(result.media[0]).toMatchObject({ mimeType: 'image/jpeg', width: 1600, height: 1200 });
    expect(labelsIn(fakePictureIn(result.media[0].data as Uint8Array)!)).toBe('ABCD');
  });

  it('a picture within 1600 x 1200 whose file is over 1.5 MB is saved again as a JPEG (was: as it is)', async () => {
    const photo = { id: 'photo-1', format: 'bmp', width: 1600, height: 1200, fileBytes: 5_760_054 } as const;
    const result = await phonePhotos([photo]);
    expect(result.media[0]).toMatchObject({ mimeType: 'image/jpeg', width: 1600, height: 1200 });
    expect(result.media[0].data).not.toBe(fakeMedia.files.get(localUri(photo)));
  });

  it('twelve large photos are opened one at a time, and each goes in bounded', async () => {
    const photos = Array.from({ length: 12 }, (_unused, index) => (
      { id: `photo-${index + 1}`, format: 'jpeg', width: 4032, height: 3024, fileBytes: 4 * MB } as const
    ));
    const result = await phonePhotos(photos);
    expect(result.media.map(item => [item.id, item.width, item.height]))
      .toEqual(photos.map(photo => [photo.id, 1600, 1200]));
    expect(fakeMedia.deviceOpened).toEqual(photos.map(localUri));
    expect(fakeMedia.deviceOpenAtOnce).toBe(1);
    expect(fakeMedia.deviceOpenNow).toBe(0);
  });

  // Guards: these already hold on 594a71d.
  it.each([
    ['a JPEG', 'jpeg', 'image/jpeg'],
    ['a PNG', 'png', 'image/png'],
  ] as const)('%s already within the limits goes in as it is, byte for byte', async (_name, format, mimeType) => {
    const photo = { id: 'photo-1', format, width: 1600, height: 1200, fileBytes: REPORT_PHOTO_AS_IS_MAX_BYTES } as const;
    const result = await phonePhotos([photo]);
    expect(result.media[0]).toMatchObject({ mimeType, width: 1600, height: 1200 });
    expect(result.media[0].data).toBe(fakeMedia.files.get(localUri(photo)));
    expect(fakeMedia.deviceOpened).toEqual([]);
  });

  it('the desktop report makes the same photo the same size', async () => {
    const photo = { id: 'photo-1', format: 'jpeg', width: 4032, height: 3024, fileBytes: 4 * MB } as const;
    const [phone, desktop] = [await phonePhotos([photo]), await desktopPhotos([photo])];
    expect([desktop.media[0].width, desktop.media[0].height]).toEqual([1600, 1200]);
    expect([phone.media[0].width, phone.media[0].height]).toEqual([desktop.media[0].width, desktop.media[0].height]);
  });
});

describe('F04: a PDF drawing excerpt on the phone and iPad', () => {
  it('an excerpt larger than 1600 x 1200 is made smaller (was: put in at whatever size the page rendered)', async () => {
    const result = await phoneDrawing(pdfDrawing(WHOLE_SHEET, 5400, 3600));
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media[0]).toMatchObject({ mimeType: 'image/jpeg', width: 1600, height: 1067 });
    const embedded = fakePictureIn(result.media[0].data as Uint8Array)!;
    expect(embedded).toMatchObject({ width: 1600, height: 1067 });
    expect(labelsIn(embedded)).toBe('ABCD');
    // Neither the rendered excerpt nor the smaller copy is left behind.
    expect([...fakeMedia.files.keys()]).toEqual([SHEET_URI]);
  });

  it('its on-screen preview is made smaller too (was: kept at whatever size the page rendered)', async () => {
    const previewUri = await renderNativeReportDrawingPreview(pdfDrawing(WHOLE_SHEET, 5400, 3600));
    expect(fakePictureIn(fakeMedia.files.get(previewUri)!)).toMatchObject({ width: 1600, height: 1067 });
    expect([...fakeMedia.files.keys()].sort()).toEqual([SHEET_URI, previewUri].sort());
  });

  // Guard: this already holds on 594a71d.
  it('an excerpt already within 1600 x 1200 goes in as the renderer made it', async () => {
    const result = await phoneDrawing(pdfDrawing(TOP_RIGHT, 780, 624));
    expect(result.media[0]).toMatchObject({ width: 780, height: 624 });
    expect(fakeMedia.deviceOpened).toEqual([]);
    expect([...fakeMedia.files.keys()]).toEqual([SHEET_URI]);
  });
});

describe('F04: a very large drawing scan on the phone and iPad', () => {
  it('a 276-megapixel scan is not cropped; it is listed with its size and what to do (was: opened whatever its size)', async () => {
    fakeMedia.files.set(SHEET_URI, fakeImageBytes('jpeg', quadrantSheet(19_200, 14_400)));
    const result = await phoneDrawing(drawing(TOP_RIGHT));
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia.map(item => item.reason)).toEqual([
      'This drawing picture is too large to crop on this device (19,200 x 14,400 pixels). ' +
      'Save it at a lower resolution and its excerpt will be included.',
    ]);
    expect(reportDrawingScanTooLargeMessage(19_200, 14_400)).toBe(result.unavailableMedia[0].reason);
    expect(fakeMedia.deviceCrops).toEqual([]);
    expect([...fakeMedia.files.keys()]).toEqual([SHEET_URI]);
  });

  it('it has no on-screen preview either, for the same reason', async () => {
    fakeMedia.files.set(SHEET_URI, fakeImageBytes('jpeg', quadrantSheet(19_200, 14_400)));
    await expect(renderNativeReportDrawingPreview(drawing(TOP_RIGHT)))
      .rejects.toThrow(reportDrawingScanTooLargeMessage(19_200, 14_400));
  });

  // Guard: this already holds on 594a71d.
  it('a 36 x 48 in sheet scanned at 300 dpi (155.5 megapixels) is still cropped, to at most 1600 x 1200', async () => {
    fakeMedia.files.set(SHEET_URI, fakeImageBytes('jpeg', quadrantSheet(14_400, 10_800)));
    const result = await phoneDrawing(drawing(TOP_RIGHT));
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media[0].width).toBeLessThanOrEqual(1600);
    expect(result.media[0].height).toBeLessThanOrEqual(1200);
    expect(labelsIn(fakePictureIn(result.media[0].data as Uint8Array)!)).toBe('B');
  });
});

describe('F04: the report\'s sources are fetched one at a time, and the notice comes before the share sheet', () => {
  it('oneAtATime runs each piece of work only after the one before it has finished, and keeps the order', async () => {
    let running = 0;
    let mostAtOnce = 0;
    const started: number[] = [];
    const results = await oneAtATime([30, 10, 20], async milliseconds => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      started.push(milliseconds);
      await new Promise(resolve => setTimeout(resolve, milliseconds));
      running -= 1;
      return `after ${milliseconds}`;
    });
    expect(results).toEqual(['after 30', 'after 10', 'after 20']);
    expect(started).toEqual([30, 10, 20]);
    expect(mostAtOnce).toBe(1);
  });

  it('oneAtATime stops at the first failure, as awaiting each in turn does', async () => {
    const seen: number[] = [];
    await expect(oneAtATime([1, 2, 3], async value => {
      seen.push(value);
      if (value === 2) throw new Error('second failed');
      return value;
    })).rejects.toThrow('second failed');
    expect(seen).toEqual([1, 2]);
  });

  const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
  const wordExport = app.slice(
    app.indexOf('const reportPhotoIdSet = new Set(reportPhotoIds);'),
    app.indexOf('async function resolveReportDrawingPreview('),
  );

  it('the phone\'s Word export fetches cited photos and drawings one at a time (was: all at once)', () => {
    expect(wordExport.length).toBeGreaterThan(1_000);
    expect(wordExport).not.toMatch(/Promise\.all\(/);
    // One photo of one update at a time, then one drawing at a time.
    expect(wordExport).toMatch(/oneAtATime\(relevantUpdates,[\s\S]*?oneAtATime\(\s*update\.photos\.filter\(photo => reportPhotoIdSet\.has\(photo\.id\)\),[\s\S]*?hydrateRecoveredProjectUpdatePhotos\(\{ \.\.\.update, photos: \[photo\] \}\)/);
    expect(wordExport).toMatch(/oneAtATime\(drawingReferences, async reference => \{[\s\S]*?ensureVerifiedReferenceDocumentBytes\(reference\.excerpt\.document\)/);
  });

  it('the notice that pictures were left out is read before the share sheet opens (was: after)', () => {
    const notice = wordExport.indexOf("'Word report prepared'");
    const share = wordExport.indexOf('await Sharing.shareAsync(fileUri');
    const written = wordExport.indexOf('await FileSystem.writeAsStringAsync(fileUri, base64');
    expect(written).toBeGreaterThan(0);
    expect(notice).toBeGreaterThan(written);
    expect(share).toBeGreaterThan(notice);
    // It is still waited for, and still says where each one is listed.
    expect(wordExport.slice(written, share)).toMatch(/await new Promise<void>\(resolve => Alert\.alert\(\n\s+'Word report prepared',/);
    expect(wordExport.slice(written, share)).toContain('Each unavailable source image is listed in Media Requiring Review.');
  });
});
