/**
 * Build 231 E1 item 4: a drawing kept as a picture saved for print (CMYK) or
 * as 16-bit grey could not be cropped on the phone or iPad. Build 231's image
 * tool (expo-image-manipulator 57.0.21) opens these; the report now redraws
 * every excerpt before it saves it, so what goes into the Word file is an
 * ordinary 8-bit colour JPEG and not a CMYK one. When a tool still cannot
 * open the picture it is left out and the reason says why, as before.
 *
 * The real phone resolver runs with only the platform picture I/O replaced
 * (tests/fixtures/report-word-media-fakes).
 */
import { Image } from 'react-native';
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';
import {
  renderNativeReportDrawingPreview,
  resolveNativeReportWordMedia,
} from '../../services/ReportWordMedia.native';
import {
  fakeFormatOf,
  fakeImageBytes,
  fakeImageGetSize,
  fakeMedia,
  fakePictureIn,
  fakeSavedAsCmyk,
  labelsIn,
  quadrantSheet,
} from '../fixtures/report-word-media-fakes';

jest.mock('expo-file-system', () => require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-image-manipulator', () => require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition', () => ({ renderPdfExcerpt: jest.fn() }));

type Region = { x: number; y: number; width: number; height: number };

const SHEET_URI = 'file:///documents/project-documents/site-plan.jpg';
/** Sits wholly inside the top-right quarter (B on the labelled sheet), margin included. */
const TOP_RIGHT: Region = { x: 0.6, y: 0.1, width: 0.3, height: 0.3 };

function reference(region: Region): ReportDrawingReference {
  const citation = { documentId: 'site-plan', label: 'Site Plan · Rev 2 · Sheet C1.0' };
  return {
    id: 'ref-1',
    projectName: '2321 Compliance Project',
    areaName: 'North Lot',
    citation,
    excerpt: {
      document: { id: 'site-plan', name: 'Site Plan', originalFileName: 'site-plan.jpg', mimeType: 'image/jpeg', uri: SHEET_URI },
      pageNumber: 1,
      region,
      citation,
    },
  } as unknown as ReportDrawingReference;
}

function storeSheet(format: 'jpeg' | 'png', width: number, height: number, printForm?: 'CMYK' | '16-bit grey') {
  fakeMedia.files.set(SHEET_URI, fakeImageBytes(format, quadrantSheet(width, height)));
  if (printForm) fakeMedia.devicePrintForm.set(SHEET_URI, printForm);
}

const report = (region: Region = TOP_RIGHT) => resolveNativeReportWordMedia({
  updates: [],
  reportPhotoIds: [],
  drawingReferences: [reference(region)],
});

beforeEach(() => {
  fakeMedia.reset();
  jest.spyOn(Image, 'getSize').mockImplementation(fakeImageGetSize as never);
});
afterEach(() => jest.restoreAllMocks());

describe('E1 item 4: a drawing picture saved for print (CMYK) or as 16-bit grey', () => {
  it('a CMYK sheet small enough to need no resizing is cropped and goes in as an ordinary colour JPEG (was: a CMYK JPEG)', async () => {
    // 1000 x 800: the cited area is about 390 x 312 px, inside the 1600 x 1200 an excerpt may be.
    storeSheet('jpeg', 1000, 800, 'CMYK');
    const result = await report();
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media).toHaveLength(1);
    const excerpt = result.media[0].data as Uint8Array;
    expect(fakeFormatOf(excerpt)).toBe('jpeg');
    expect(result.media[0].mimeType).toBe('image/jpeg');
    expect(labelsIn(fakePictureIn(excerpt)!)).toBe('B');
    expect(fakeSavedAsCmyk(excerpt)).toBe(false);
    // Still the one crop by the shared rule, saved at its own size.
    expect(fakeMedia.deviceCrops).toHaveLength(1);
    expect(fakeMedia.deviceCrops[0]).toMatchObject({
      outputWidth: fakeMedia.deviceCrops[0].width,
      outputHeight: fakeMedia.deviceCrops[0].height,
    });
  });

  it('its on-screen preview is an ordinary colour JPEG too (was: a CMYK JPEG)', async () => {
    storeSheet('jpeg', 1000, 800, 'CMYK');
    const previewUri = await renderNativeReportDrawingPreview(reference(TOP_RIGHT));
    const preview = fakeMedia.files.get(previewUri)!;
    expect(labelsIn(fakePictureIn(preview)!)).toBe('B');
    expect(fakeSavedAsCmyk(preview)).toBe(false);
  });

  // Guards: these already hold on 594a71d with the image tool Build 231 has.
  it('a large CMYK sheet is cropped and resized, which already made it an ordinary colour JPEG', async () => {
    storeSheet('jpeg', 12000, 9000, 'CMYK');
    const result = await report();
    expect(result.unavailableMedia).toEqual([]);
    const excerpt = result.media[0].data as Uint8Array;
    expect(labelsIn(fakePictureIn(excerpt)!)).toBe('B');
    expect(fakeSavedAsCmyk(excerpt)).toBe(false);
    expect(result.media[0].width).toBeLessThanOrEqual(1600);
    expect(result.media[0].height).toBeLessThanOrEqual(1200);
  });

  it('a 16-bit grey PNG sheet is cropped and goes in as a JPEG', async () => {
    storeSheet('png', 1000, 800, '16-bit grey');
    const result = await report();
    expect(result.unavailableMedia).toEqual([]);
    const excerpt = result.media[0].data as Uint8Array;
    expect(fakeFormatOf(excerpt)).toBe('jpeg');
    expect(labelsIn(fakePictureIn(excerpt)!)).toBe('B');
    expect(fakeSavedAsCmyk(excerpt)).toBe(false);
  });

  it('when the image tool cannot open the picture at all it is left out, and the reason says why and what to do', async () => {
    storeSheet('jpeg', 4000, 3000, 'CMYK');
    fakeMedia.deviceCannotOpen.add(SHEET_URI);
    const result = await report();
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia.map(item => item.reason)).toEqual([
      'The JPEG drawing could not be cropped on this device. ' +
      'If it was saved for print (CMYK) or as 16-bit grey, save it again as an ordinary colour picture.',
    ]);
    expect(fakeMedia.deviceCrops).toEqual([]);
  });
});
