/**
 * Review pass 1, L6 and L7 (caused by "Word report on the phone and iPad:
 * each picture is bounded and handled one at a time ...").
 *
 * L6: "one picture at a time" was proved by a stand-in that let go of a
 * picture when it was saved. The real image tool keeps every picture it
 * opens, and every picture it hands back, until release() is called or the
 * garbage collector gets to it, and the report never called release(). The
 * stand-in now holds as the real tool does (tests/fixtures/
 * report-word-media-fakes), and every test here fails if the report leaves
 * anything held or holds more than one picture's worth at once.
 *
 * L7: the "too large to crop" refusal came after the tool had read the whole
 * file into memory (and, for a picture stored on its side, redrawn it at full
 * size). It is now made from the file's header before the tool is given the
 * file, for the types whose header the app reads.
 *
 * The real phone resolver runs with only the platform picture I/O replaced.
 */
import { Image } from 'react-native';
import { renderPdfExcerpt } from '../../modules/dave-text-recognition';
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';
import {
  renderNativeReportDrawingPreview,
  resolveNativeReportWordMedia,
} from '../../services/ReportWordMedia.native';
import { reportDrawingScanTooLargeMessage } from '../../services/ReportWordMediaLimits';
import type { ProjectUpdate } from '../../types';
import {
  expectFakeDeviceLetGoOfEveryPicture,
  FAKE_DEVICE_PICTURES_FOR_ONE,
  fakeImageBytes,
  fakeImageGetSize,
  fakeMedia,
  fakePictureIn,
  labelsIn,
  quadrantSheet,
  type FakeImageFile,
  type FakeImageFormat,
} from '../fixtures/report-word-media-fakes';

jest.mock('expo-file-system', () => require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-image-manipulator', () => require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition', () => ({ renderPdfExcerpt: jest.fn() }));

type Photo = { id: string; format: FakeImageFormat; width: number; height: number; fileBytes?: number; file?: FakeImageFile };
type Region = { x: number; y: number; width: number; height: number };

const MB = 1_000_000;
const TWELVE_MEGAPIXELS = 4032 * 3024;
const BOUNDED = 1600 * 1200;
const localUri = (photo: Photo) => `file:///documents/photos/${photo.id}`;

function storePhotos(photos: readonly Photo[]): ProjectUpdate {
  return {
    id: 'update-1',
    projectName: 'Lot 9',
    selectedAreaName: 'North Pad',
    scheduleTaskName: 'Grade pad',
    date: '2026-10-01',
    photos: photos.map(photo => {
      // The picture is the upright one a device shows, whichever way the file keeps it.
      fakeMedia.files.set(localUri(photo), fakeImageBytes(photo.format, quadrantSheet(photo.width, photo.height), photo.file));
      if (photo.fileBytes) fakeMedia.fileSizes.set(localUri(photo), photo.fileBytes);
      return { id: photo.id, uri: localUri(photo), caption: photo.id };
    }),
  } as unknown as ProjectUpdate;
}

const phonePhotos = (photos: readonly Photo[]) => resolveNativeReportWordMedia({
  updates: [storePhotos(photos)],
  reportPhotoIds: photos.map(photo => photo.id),
  drawingReferences: [],
});

const SHEET_URI = 'file:///documents/project-documents/site-plan';
const TOP_RIGHT: Region = { x: 0.6, y: 0.1, width: 0.3, height: 0.3 };
const WHOLE_SHEET: Region = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 };

function drawing(region: Region, document: Record<string, unknown> = {}): ReportDrawingReference {
  const citation = { documentId: 'site-plan', label: 'Site Plan · Sheet C1.0' };
  return {
    id: 'ref-1',
    projectName: 'Lot 9',
    areaName: 'North Pad',
    citation,
    excerpt: {
      document: { id: 'site-plan', name: 'Site Plan', originalFileName: 'site-plan.jpg', mimeType: 'image/jpeg', uri: SHEET_URI, ...document },
      pageNumber: 1,
      region,
      citation,
    },
  } as unknown as ReportDrawingReference;
}

function storeSheet(format: FakeImageFormat, width: number, height: number, file?: FakeImageFile) {
  fakeMedia.files.set(SHEET_URI, fakeImageBytes(format, quadrantSheet(width, height), file));
}

const phoneDrawing = (reference: ReportDrawingReference) => resolveNativeReportWordMedia({
  updates: [],
  reportPhotoIds: [],
  drawingReferences: [reference],
});

function pdfDrawing(region: Region, excerptWidth: number, excerptHeight: number) {
  fakeMedia.files.set(SHEET_URI, fakeImageBytes('pdf'));
  jest.mocked(renderPdfExcerpt).mockImplementation(async () => {
    const uri = `file:///tmp/vitruvius-drawing-${fakeMedia.files.size}.jpg`;
    fakeMedia.files.set(uri, fakeImageBytes('jpeg', quadrantSheet(excerptWidth, excerptHeight)));
    return { uri, width: excerptWidth, height: excerptHeight };
  });
  return drawing(region, { originalFileName: 'site-plan.pdf', mimeType: 'application/pdf' });
}

beforeEach(() => {
  fakeMedia.reset();
  jest.mocked(renderPdfExcerpt).mockReset();
  jest.spyOn(Image, 'getSize').mockImplementation(fakeImageGetSize as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  // Every test in this file: nothing left held, and never more than one picture's worth at once.
  expectFakeDeviceLetGoOfEveryPicture();
});

describe('L6: the report lets go of each picture as soon as its bytes are saved', () => {
  it('forty 12-megapixel photos: one photo and its smaller copy at the most, and nothing afterwards (was: all forty, and their copies, until the garbage collector)', async () => {
    const photos = Array.from({ length: 40 }, (_unused, index) => (
      { id: `photo-${index + 1}`, format: 'jpeg', width: 4032, height: 3024, fileBytes: 4 * MB } as const
    ));
    const result = await phonePhotos(photos);
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media.map(item => [item.width, item.height])).toEqual(photos.map(() => [1600, 1200]));
    expect({
      openAtOnce: fakeMedia.deviceOpenAtOnce,
      picturesAtOnce: fakeMedia.devicePicturesAtOnce,
      pixelsAtOnce: fakeMedia.devicePixelsAtOnce,
      openAfter: fakeMedia.deviceOpenNow,
      picturesAfter: fakeMedia.devicePicturesNow,
      pixelsAfter: fakeMedia.devicePixelsNow,
    }).toEqual({
      openAtOnce: 1,
      picturesAtOnce: FAKE_DEVICE_PICTURES_FOR_ONE,
      pixelsAtOnce: TWELVE_MEGAPIXELS + BOUNDED,
      openAfter: 0,
      picturesAfter: 0,
      pixelsAfter: 0,
    });
  });

  it('forty photos taken with the phone held upright (stored on their side): the upright redraw and nothing more', async () => {
    const photos = Array.from({ length: 40 }, (_unused, index) => ({
      id: `photo-${index + 1}`, format: 'jpeg', width: 3024, height: 4032, fileBytes: 4 * MB,
      file: { stored: 'stored on its side' },
    } as const));
    const result = await phonePhotos(photos);
    expect(result.media.map(item => [item.width, item.height])).toEqual(photos.map(() => [900, 1200]));
    // The tool redraws such a photo upright at full size as it loads it: two full-size pictures for a moment.
    expect(fakeMedia.devicePicturesAtOnce).toBe(FAKE_DEVICE_PICTURES_FOR_ONE);
    expect(fakeMedia.devicePixelsAtOnce).toBe(2 * TWELVE_MEGAPIXELS);
    expect(fakeMedia.deviceOpenAtOnce).toBe(1);
  });

  it('while a smaller copy is being written to a file, the full-size picture it came from is already gone', async () => {
    await phonePhotos([
      { id: 'landscape', format: 'jpeg', width: 4032, height: 3024, fileBytes: 4 * MB },
      { id: 'heic', format: 'heic', width: 4032, height: 3024, fileBytes: 2 * MB },
    ]);
    storeSheet('jpeg', 9000, 6000);
    const sheet = await phoneDrawing(drawing(TOP_RIGHT));
    const excerpt = sheet.media[0];
    // Writing a JPEG takes the longest; only the picture being written is held through it.
    expect(fakeMedia.devicePixelsWhileSaving).toEqual([BOUNDED, BOUNDED, excerpt.width * excerpt.height]);
  });

  it('a mixed report (photos, a picture drawing, a PDF drawing) holds one picture\'s worth at the most', async () => {
    const photos: Photo[] = [
      { id: 'heic', format: 'heic', width: 4032, height: 3024, fileBytes: 2 * MB },
      { id: 'big-jpeg', format: 'jpeg', width: 4032, height: 3024, fileBytes: 4 * MB },
      { id: 'small-jpeg', format: 'jpeg', width: 1200, height: 900, fileBytes: 0.3 * MB },
      { id: 'heavy-png', format: 'png', width: 1600, height: 1200, fileBytes: 5 * MB },
    ];
    const update = storePhotos(photos);
    storeSheet('jpeg', 9000, 6000);
    const pdfUri = 'file:///documents/project-documents/details.pdf';
    const pdf = pdfDrawing(WHOLE_SHEET, 5400, 3600);
    fakeMedia.files.set(pdfUri, fakeMedia.files.get(SHEET_URI)!);
    storeSheet('jpeg', 9000, 6000);
    const result = await resolveNativeReportWordMedia({
      updates: [update],
      reportPhotoIds: photos.map(photo => photo.id),
      drawingReferences: [
        drawing(TOP_RIGHT),
        { ...pdf, id: 'ref-2', excerpt: { ...pdf.excerpt, document: { ...pdf.excerpt.document, uri: pdfUri } } },
      ],
    });
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media).toHaveLength(6);
    expect(fakeMedia.deviceOpenAtOnce).toBe(1);
    expect(fakeMedia.devicePicturesAtOnce).toBe(FAKE_DEVICE_PICTURES_FOR_ONE);
  });

  it.each([
    ['the picture cannot be opened', (): void => { fakeMedia.deviceCannotOpen.add('file:///documents/photos/photo-1'); }],
    ['what was saved is not a JPEG or a PNG', (): void => { fakeMedia.deviceWrites = 'webp'; }],
  ] as const)('a photo is let go of when %s', async (_name, arrange) => {
    arrange();
    const result = await phonePhotos([{ id: 'photo-1', format: 'jpeg', width: 4032, height: 3024, fileBytes: 4 * MB }]);
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia).toHaveLength(1);
    expect(fakeMedia.deviceOpened).toHaveLength(1);
    expect([fakeMedia.deviceOpenNow, fakeMedia.devicePicturesNow]).toEqual([0, 0]);
  });

  it.each([
    ['it is cropped', (): void => undefined, TOP_RIGHT, 1],
    ['the picture cannot be opened', (): void => { fakeMedia.deviceCannotOpen.add(SHEET_URI); }, TOP_RIGHT, 0],
    ['what was saved is not a JPEG or a PNG', (): void => { fakeMedia.deviceWrites = 'webp'; }, TOP_RIGHT, 0],
    ['its cited area is not a usable one', (): void => undefined, { x: 0.5, y: 0.5, width: 0, height: 0 }, 0],
  ] as const)('a picture drawing is let go of when %s', async (_name, arrange, region, included) => {
    storeSheet('jpeg', 9000, 6000);
    arrange();
    const result = await phoneDrawing(drawing(region));
    expect(result.media).toHaveLength(included);
    expect(result.unavailableMedia).toHaveLength(1 - included);
    expect([fakeMedia.deviceOpenNow, fakeMedia.devicePicturesNow]).toEqual([0, 0]);
  });

  it('a PDF excerpt that has to be made smaller is let go of, in the report and in the preview', async () => {
    const result = await phoneDrawing(pdfDrawing(WHOLE_SHEET, 5400, 3600));
    expect(result.media[0]).toMatchObject({ width: 1600, height: 1067 });
    expect(fakeMedia.deviceOpened).toHaveLength(1);
    expect([fakeMedia.deviceOpenNow, fakeMedia.devicePicturesNow]).toEqual([0, 0]);
    await renderNativeReportDrawingPreview(pdfDrawing(WHOLE_SHEET, 5400, 3600));
    expect(fakeMedia.deviceOpened).toHaveLength(2);
    expect([fakeMedia.deviceOpenNow, fakeMedia.devicePicturesNow]).toEqual([0, 0]);
  });

  it('a PDF excerpt is let go of when the smaller copy cannot be made', async () => {
    const reference = pdfDrawing(WHOLE_SHEET, 5400, 3600);
    jest.mocked(renderPdfExcerpt).mockImplementation(async () => {
      // The renderer hands back a file the image tool cannot open.
      const uri = 'file:///tmp/vitruvius-drawing-unreadable.jpg';
      fakeMedia.files.set(uri, fakeImageBytes('jpeg'));
      return { uri, width: 5400, height: 3600 };
    });
    const result = await phoneDrawing(reference);
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia).toHaveLength(1);
    expect([fakeMedia.deviceOpenNow, fakeMedia.devicePicturesNow]).toEqual([0, 0]);
    // The file the renderer made is not left behind either.
    expect([...fakeMedia.files.keys()]).toEqual([SHEET_URI]);
  });

  it('the on-screen preview of a picture drawing is let go of too', async () => {
    storeSheet('jpeg', 9000, 6000);
    const previewUri = await renderNativeReportDrawingPreview(drawing(TOP_RIGHT));
    expect(labelsIn(fakePictureIn(fakeMedia.files.get(previewUri)!)!)).toBe('B');
    expect([fakeMedia.deviceOpenNow, fakeMedia.devicePicturesNow]).toEqual([0, 0]);
  });
});

describe('L6: a photo that needs neither converting nor making smaller is never opened', () => {
  it.each([
    ['a JPEG', 'jpeg', 'image/jpeg'],
    ['a PNG', 'png', 'image/png'],
    ['a GIF', 'gif', 'image/gif'],
    ['a BMP', 'bmp', 'image/bmp'],
  ] as const)('%s within the limits goes in as it is; its size comes from its own header (was: the device read the whole file to say)', async (_name, format, mimeType) => {
    const photo = { id: 'photo-1', format, width: 1600, height: 1200, fileBytes: 1.5 * MB } as const;
    const result = await phonePhotos([photo]);
    expect(result.media[0]).toMatchObject({ mimeType, width: 1600, height: 1200 });
    expect(result.media[0].data).toBe(fakeMedia.files.get(localUri(photo)));
    expect(fakeMedia.deviceOpened).toEqual([]);
    expect(fakeMedia.deviceSizeAsked).toEqual([]);
  });

  it('a small JPEG stored on its side is sized as it is shown, as the device sizes it', async () => {
    // Stored 1200 x 1600 on its side: shown 1600 wide and 1200 high, so it fits and goes in as it is.
    const fits = { id: 'fits', format: 'jpeg', width: 1600, height: 1200, fileBytes: 0.4 * MB, file: { stored: 'stored on its side' } } as const;
    // Stored 1600 x 1200 on its side: shown 1200 wide and 1600 high, which is too tall, so it is made smaller.
    const tooTall = { id: 'too-tall', format: 'jpeg', width: 1200, height: 1600, fileBytes: 0.4 * MB, file: { stored: 'stored on its side' } } as const;
    const result = await phonePhotos([fits, tooTall]);
    expect(result.media.map(item => [item.id, item.width, item.height])).toEqual([
      ['fits', 1600, 1200],
      ['too-tall', 900, 1200],
    ]);
    expect(result.media[0].data).toBe(fakeMedia.files.get(localUri(fits)));
    expect(fakeMedia.deviceOpened).toEqual([localUri(tooTall)]);
    expect(fakeMedia.deviceSizeAsked).toEqual([]);
  });

  it('a photo whose header is cut short is sized by the device, as before', async () => {
    const photo = { id: 'photo-1', format: 'jpeg', width: 800, height: 600, fileBytes: 0.2 * MB, file: { header: 'cut short' } } as const;
    const result = await phonePhotos([photo]);
    expect(result.media[0]).toMatchObject({ mimeType: 'image/jpeg', width: 800, height: 600 });
    expect(result.media[0].data).toBe(fakeMedia.files.get(localUri(photo)));
    expect(fakeMedia.deviceSizeAsked).toEqual([localUri(photo)]);
    expect(fakeMedia.deviceOpened).toEqual([]);
  });

  it('a photo that does need making smaller is opened once, and the device is not asked its size first', async () => {
    const small = { id: 'small-file', format: 'jpeg', width: 4032, height: 3024, fileBytes: 0.9 * MB } as const;
    const large = { id: 'large-file', format: 'jpeg', width: 4032, height: 3024, fileBytes: 4 * MB } as const;
    const result = await phonePhotos([small, large]);
    expect(result.media.map(item => [item.width, item.height])).toEqual([[1600, 1200], [1600, 1200]]);
    expect(fakeMedia.deviceOpened).toEqual([localUri(small), localUri(large)]);
    expect(fakeMedia.deviceSizeAsked).toEqual([]);
  });
});

describe('L7: a scan that is too large is refused from its header, before the image tool is given the file', () => {
  it.each([
    ['JPEG', 'jpeg', 19_200, 14_400],
    ['PNG', 'png', 19_200, 14_400],
    ['TIFF', 'tiff', 19_200, 14_400],
    ['BMP', 'bmp', 19_200, 14_400],
    ['GIF', 'gif', 19_200, 14_400],
    ['WebP', 'webp', 16_000, 10_001],
  ] as const)('a %s scan over 160 megapixels: the tool never opens it (was: it read the whole file first)', async (_name, format, width, height) => {
    storeSheet(format, width, height);
    const result = await phoneDrawing(drawing(TOP_RIGHT));
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia.map(item => item.reason)).toEqual([reportDrawingScanTooLargeMessage(width, height)]);
    expect(fakeMedia.deviceOpened).toEqual([]);
    expect(fakeMedia.devicePixelsAtOnce).toBe(0);
  });

  it.each([
    ['JPEG', 'jpeg'],
    ['TIFF', 'tiff'],
  ] as const)('a %s scan stored on its side: refused with no full-size redraw, and its size given as it is shown', async (_name, format) => {
    // Kept as 19,200 x 14,400 on its side; shown 14,400 wide and 19,200 high.
    storeSheet(format, 14_400, 19_200, { stored: 'stored on its side' });
    const result = await phoneDrawing(drawing(TOP_RIGHT));
    expect(result.unavailableMedia.map(item => item.reason)).toEqual([
      'This drawing picture is too large to crop on this device (14,400 x 19,200 pixels). ' +
      'Save it at a lower resolution and its excerpt will be included.',
    ]);
    expect(fakeMedia.deviceOpened).toEqual([]);
    expect(fakeMedia.devicePixelsAtOnce).toBe(0);
  });

  it('its on-screen preview is refused the same way, without opening it', async () => {
    storeSheet('jpeg', 19_200, 14_400);
    await expect(renderNativeReportDrawingPreview(drawing(TOP_RIGHT)))
      .rejects.toThrow(reportDrawingScanTooLargeMessage(19_200, 14_400));
    expect(fakeMedia.deviceOpened).toEqual([]);
  });

  it.each([
    ['a HEIC scan (the app does not read a size from a HEIC header)', 'heic', {}],
    ['a JPEG scan whose header is cut short', 'jpeg', { header: 'cut short' }],
  ] as const)('%s is still refused, after the tool has loaded it, and is let go of at once', async (_name, format, file) => {
    storeSheet(format, 19_200, 14_400, file);
    const result = await phoneDrawing(drawing(TOP_RIGHT));
    expect(result.unavailableMedia.map(item => item.reason)).toEqual([reportDrawingScanTooLargeMessage(19_200, 14_400)]);
    expect(fakeMedia.deviceOpened).toEqual([SHEET_URI]);
    expect(fakeMedia.deviceCrops).toEqual([]);
    expect([fakeMedia.deviceOpenNow, fakeMedia.devicePicturesNow]).toEqual([0, 0]);
  });

  // Guards: these already hold.
  it('a scan of exactly 160 megapixels is still cropped to its cited part', async () => {
    storeSheet('jpeg', 16_000, 10_000);
    const result = await phoneDrawing(drawing(TOP_RIGHT));
    expect(result.unavailableMedia).toEqual([]);
    expect(labelsIn(fakePictureIn(result.media[0].data as Uint8Array)!)).toBe('B');
  });

  it('a scan one row over is refused', async () => {
    storeSheet('jpeg', 16_000, 10_001);
    const result = await phoneDrawing(drawing(TOP_RIGHT));
    expect(result.unavailableMedia.map(item => item.reason)).toEqual([reportDrawingScanTooLargeMessage(16_000, 10_001)]);
  });
});
