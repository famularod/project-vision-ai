/**
 * Independent review R06 (Build 229): the phone and iPad Word report embedded
 * the whole sheet for a drawing kept as a picture while describing it as an
 * excerpt; the desktop report cropped it. Both now crop by one shared rule.
 * These run the real native resolver and the real desktop resolver with only
 * the platform picture I/O replaced (tests/fixtures/report-word-media-fakes).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Image } from 'react-native';
import { renderPdfExcerpt } from '../../modules/dave-text-recognition';
import {
  planReportDrawingCrop,
  REPORT_DRAWING_CROP_MIN_PIXELS,
  REPORT_DRAWING_CROP_PADDING,
  REPORT_DRAWING_INVALID_REGION_MESSAGE,
  reportDrawingCropBounds,
} from '../../services/ReportDrawingCrop';
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';
import { summarizeReportWordUnavailableMedia } from '../../services/ReportWordDocument';
import { reportDrawingNotCroppedMessage } from '../../services/ReportWordImageFormat';
import {
  renderNativeReportDrawingPreview,
  resolveNativeReportWordMedia,
} from '../../services/ReportWordMedia.native';
import { resolveWebReportWordMedia } from '../../services/ReportWordMedia.web';
import {
  fakeImageBytes,
  fakeImageGetSize,
  fakeMedia,
  fakePictureIn,
  installFakeBrowser,
  labelsIn,
  quadrantSheet,
} from '../fixtures/report-word-media-fakes';

jest.mock('expo-file-system', () => require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-image-manipulator', () => require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition', () => ({ renderPdfExcerpt: jest.fn() }));

type Region = { x: number; y: number; width: number; height: number };

const SHEET_URI = 'file:///documents/project-documents/site-plan.jpg';
const SHEET_URL = 'https://cloud.example.test/project-documents/site-plan.jpg';
/** Sits wholly inside the top-right quarter, margin included. */
const TOP_RIGHT: Region = { x: 0.6, y: 0.1, width: 0.3, height: 0.3 };

function reference(region: Region, document: Record<string, unknown> = {}): ReportDrawingReference {
  const citation = { documentId: 'site-plan', label: 'Site Plan · Rev 2 · Sheet C1.0' };
  return {
    id: 'ref-1',
    projectName: '2321 Compliance Project',
    areaName: 'North Lot',
    citation,
    excerpt: {
      document: {
        id: 'site-plan',
        name: 'Site Plan',
        originalFileName: 'site-plan.jpg',
        mimeType: 'image/jpeg',
        uri: SHEET_URI,
        storagePath: 'owner/site-plan.jpg',
        ...document,
      },
      pageNumber: 1,
      region,
      citation,
    },
  } as unknown as ReportDrawingReference;
}

/** Puts the same sheet on the phone and in the cloud. */
function storeSheet(width: number, height: number) {
  const bytes = fakeImageBytes('jpeg', quadrantSheet(width, height));
  fakeMedia.files.set(SHEET_URI, bytes);
  fakeMedia.remote.set(SHEET_URL, { bytes, contentType: 'image/jpeg' });
}

const native = (region: Region, document?: Record<string, unknown>) => resolveNativeReportWordMedia({
  updates: [],
  reportPhotoIds: [],
  drawingReferences: [reference(region, document)],
});

const desktop = (region: Region) => resolveWebReportWordMedia({
  updates: [],
  reportPhotoIds: [],
  drawingReferences: [reference(region)],
  getArtifactUrl: async () => SHEET_URL,
});

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

describe('the shared drawing crop rule', () => {
  it('keeps the cited area plus a margin on every side', () => {
    const crop = planReportDrawingCrop({ x: 0.5, y: 0.5, width: 0.25, height: 0.25 }, { width: 1000, height: 1000 });
    // 0.5 less the 0.045 margin, and 0.25 plus a margin each side (a pixel of rounding either way).
    expect(REPORT_DRAWING_CROP_PADDING).toBe(0.045);
    expect(crop.originX).toBe(455);
    expect(crop.originY).toBe(455);
    expect(Math.abs(crop.width - 340)).toBeLessThanOrEqual(1);
    expect(Math.abs(crop.height - 340)).toBeLessThanOrEqual(1);
    expect(crop).toMatchObject({ outputWidth: crop.width, outputHeight: crop.height });
  });

  it.each<[string, Region, Partial<ReturnType<typeof planReportDrawingCrop>>]>([
    ['the top-left corner', { x: 0, y: 0, width: 0.2, height: 0.2 }, { originX: 0, originY: 0 }],
    ['the bottom-right corner', { x: 0.8, y: 0.8, width: 0.2, height: 0.2 }, {}],
    ['an area hanging off the left edge', { x: -0.2, y: 0.6, width: 0.5, height: 0.2 }, { originX: 0 }],
    ['an area hanging off the bottom edge', { x: 0.1, y: 0.9, width: 0.2, height: 0.4 }, {}],
    ['the whole sheet', { x: 0, y: 0, width: 1, height: 1 }, { originX: 0, originY: 0, width: 4000, height: 3000 }],
  ])('cuts %s at the edge of the sheet', (_name, region, expected) => {
    const crop = planReportDrawingCrop(region, { width: 4000, height: 3000 });
    expect(crop).toMatchObject(expected);
    expect(crop.originX).toBeGreaterThanOrEqual(0);
    expect(crop.originY).toBeGreaterThanOrEqual(0);
    expect(crop.originX + crop.width).toBeLessThanOrEqual(4000);
    expect(crop.originY + crop.height).toBeLessThanOrEqual(3000);
    if (region.x + region.width >= 1) expect(crop.originX + crop.width).toBe(4000);
    if (region.y + region.height >= 1) expect(crop.originY + crop.height).toBe(3000);
  });

  it('measures the area on the upright sheet, whichever way the picture was taken', () => {
    const landscape = planReportDrawingCrop(TOP_RIGHT, { width: 4000, height: 3000 });
    const portrait = planReportDrawingCrop(TOP_RIGHT, { width: 3000, height: 4000 });
    expect(landscape.originX / 4000).toBeCloseTo(portrait.originX / 3000, 3);
    expect(landscape.originY / 3000).toBeCloseTo(portrait.originY / 4000, 3);
    expect(landscape.width / 4000).toBeCloseTo(portrait.width / 3000, 3);
    expect(landscape.height / 3000).toBeCloseTo(portrait.height / 4000, 3);
  });

  it('saves a large area no bigger than 1600 by 1200 without changing its shape', () => {
    const crop = planReportDrawingCrop({ x: 0, y: 0, width: 1, height: 1 }, { width: 4000, height: 3000 });
    expect(crop).toMatchObject({ outputWidth: 1600, outputHeight: 1200 });
  });

  it.each<[string, unknown]>([
    ['a coordinate that is not a number', { x: Number.NaN, y: 0.1, width: 0.2, height: 0.2 }],
    ['an endless coordinate', { x: 0.1, y: 0.1, width: Number.POSITIVE_INFINITY, height: 0.2 }],
    ['a missing coordinate', { x: 0.1, y: 0.1, width: 0.2 }],
    ['text for a coordinate', { x: '0.1', y: 0.1, width: 0.2, height: 0.2 }],
    ['no width', { x: 0.1, y: 0.1, width: 0, height: 0.2 }],
    ['a negative height', { x: 0.1, y: 0.1, width: 0.2, height: -0.2 }],
    ['an area right of the sheet', { x: 1.02, y: 0.1, width: 0.2, height: 0.2 }],
    ['an area above the sheet', { x: 0.1, y: -0.5, width: 0.2, height: 0.5 }],
    ['percentages instead of fractions', { x: 60, y: 10, width: 30, height: 30 }],
    ['no region at all', null],
  ])('refuses %s', (_name, region) => {
    expect(() => reportDrawingCropBounds(region as Region)).toThrow(REPORT_DRAWING_INVALID_REGION_MESSAGE);
    expect(() => planReportDrawingCrop(region as Region, { width: 4000, height: 3000 }))
      .toThrow(REPORT_DRAWING_INVALID_REGION_MESSAGE);
  });

  it('refuses an area too small to show, and a picture with no size', () => {
    expect(() => planReportDrawingCrop({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 }, { width: 10, height: 10 }))
      .toThrow(REPORT_DRAWING_INVALID_REGION_MESSAGE);
    expect(() => planReportDrawingCrop(TOP_RIGHT, { width: 0, height: 3000 })).toThrow('no readable size');
    expect(() => planReportDrawingCrop(TOP_RIGHT, { width: Number.NaN, height: 3000 })).toThrow('no readable size');
  });

  it('is the rule the native PDF renderer was written to', () => {
    const swift = readFileSync(
      join(__dirname, '../../modules/dave-text-recognition/ios/DaveTextRecognitionModule.swift'),
      'utf8',
    );
    expect(swift).toContain(`let padding: CGFloat = ${REPORT_DRAWING_CROP_PADDING}`);
    expect(swift).toContain(
      `cropRect.width >= ${REPORT_DRAWING_CROP_MIN_PIXELS}, cropRect.height >= ${REPORT_DRAWING_CROP_MIN_PIXELS}`,
    );
    expect(swift).toContain(REPORT_DRAWING_INVALID_REGION_MESSAGE);
  });
});

describe('a drawing kept as a picture, in the phone and iPad Word report', () => {
  it('embeds the cited quarter of the sheet, not the whole sheet', async () => {
    storeSheet(4000, 3000);
    const result = await native(TOP_RIGHT);

    expect(result.unavailableMedia).toEqual([]);
    expect(result.media).toHaveLength(1);
    const [excerpt] = result.media;
    expect(labelsIn(fakePictureIn(excerpt.data)!)).toBe('B');
    expect(fakeMedia.deviceCrops).toEqual([planReportDrawingCrop(TOP_RIGHT, { width: 4000, height: 3000 })]);
    expect(excerpt).toMatchObject({
      kind: 'drawing',
      mimeType: 'image/jpeg',
      width: fakeMedia.deviceCrops[0].outputWidth,
      height: fakeMedia.deviceCrops[0].outputHeight,
      citation: 'Site Plan · Rev 2 · Sheet C1.0',
    });
    // The whole sheet was 4000 by 3000.
    expect(excerpt.width).toBeLessThan(4000);
    expect(excerpt.height).toBeLessThan(3000);
  });

  it.each<[string, Region, string]>([
    ['top-left corner', { x: 0, y: 0, width: 0.2, height: 0.2 }, 'A'],
    ['bottom-right corner', { x: 0.8, y: 0.8, width: 0.2, height: 0.2 }, 'D'],
    ['area hanging off the left edge', { x: -0.2, y: 0.6, width: 0.5, height: 0.2 }, 'C'],
    ['area across the middle', { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 'ABCD'],
  ])('embeds the %s', async (_name, region, labels) => {
    storeSheet(4000, 3000);
    const result = await native(region);
    expect(labelsIn(fakePictureIn(result.media[0].data)!)).toBe(labels);
  });

  it('crops a sheet photographed upright by its upright size', async () => {
    // The image tool hands back the picture upright: 3000 wide, 4000 tall.
    storeSheet(3000, 4000);
    const result = await native(TOP_RIGHT);
    expect(labelsIn(fakePictureIn(result.media[0].data)!)).toBe('B');
    expect(fakeMedia.deviceCrops).toEqual([planReportDrawingCrop(TOP_RIGHT, { width: 3000, height: 4000 })]);
  });

  it.each<[string, unknown]>([
    ['a coordinate that is not a number', { x: Number.NaN, y: 0.1, width: 0.2, height: 0.2 }],
    ['no width', { x: 0.1, y: 0.1, width: 0, height: 0.2 }],
    ['an area off the sheet', { x: 1.4, y: 0.1, width: 0.2, height: 0.2 }],
  ])('lists the drawing as unavailable for %s instead of showing the whole sheet', async (_name, region) => {
    storeSheet(4000, 3000);
    const result = await native(region as Region);
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia).toEqual([{
      id: 'ref-1',
      kind: 'drawing',
      label: '2321 Compliance Project · North Lot · Site Plan · Rev 2 · Sheet C1.0',
      reason: REPORT_DRAWING_INVALID_REGION_MESSAGE,
    }]);
    expect(fakeMedia.deviceCrops).toEqual([]);
  });

  it('shows the same cited area in the on-screen preview', async () => {
    storeSheet(4000, 3000);
    const previewUri = await renderNativeReportDrawingPreview(reference(TOP_RIGHT));
    expect(previewUri).not.toBe(SHEET_URI);
    expect(labelsIn(fakePictureIn(fakeMedia.files.get(previewUri)!)!)).toBe('B');
    await expect(renderNativeReportDrawingPreview(reference({ x: 0.1, y: 0.1, width: 0, height: 0.2 })))
      .rejects.toThrow(REPORT_DRAWING_INVALID_REGION_MESSAGE);
  });

  it('judges a PDF drawing area by the same rule before rendering it', async () => {
    const pdf = { uri: 'file:///documents/project-documents/site-plan.pdf', originalFileName: 'site-plan.pdf', mimeType: 'application/pdf' };
    fakeMedia.files.set(pdf.uri, fakeImageBytes('pdf'));
    const rendered = 'file:///tmp/vitruvius-drawing-1.jpg';
    fakeMedia.files.set(rendered, fakeImageBytes('jpeg', quadrantSheet(800, 600)));
    jest.mocked(renderPdfExcerpt).mockResolvedValue({ uri: rendered, width: 800, height: 600 });

    const refused = await native({ x: 1.02, y: 0.1, width: 0.2, height: 0.2 }, pdf);
    expect(refused.unavailableMedia.map(item => item.reason)).toEqual([REPORT_DRAWING_INVALID_REGION_MESSAGE]);
    expect(renderPdfExcerpt).not.toHaveBeenCalled();

    const shown = await native(TOP_RIGHT, pdf);
    expect(shown.media).toHaveLength(1);
    expect(renderPdfExcerpt).toHaveBeenCalledWith(pdf.uri, 1, TOP_RIGHT);
  });
});

describe('a picture drawing the phone\'s image tool cannot open (review pass 2 W1: a CMYK JPEG, a 16-bit grey PNG)', () => {
  const NOT_CROPPED = 'The JPEG drawing could not be cropped on this device. ' +
    'If it was saved for print (CMYK) or as 16-bit grey, save it again as an ordinary colour picture.';

  it('is listed with a reason that says what to do, and the whole sheet is never embedded instead', async () => {
    storeSheet(4000, 3000);
    fakeMedia.deviceCannotOpen.add(SHEET_URI);
    const result = await native(TOP_RIGHT);
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia).toEqual([{
      id: 'ref-1',
      kind: 'drawing',
      label: '2321 Compliance Project · North Lot · Site Plan · Rev 2 · Sheet C1.0',
      reason: NOT_CROPPED,
    }]);
    // One attempt, nothing cropped, and nothing written.
    expect(fakeMedia.deviceOpened).toEqual([SHEET_URI]);
    expect(fakeMedia.deviceCrops).toEqual([]);
    expect([...fakeMedia.files.keys()]).toEqual([SHEET_URI]);
    expect(summarizeReportWordUnavailableMedia(result.unavailableMedia))
      .toBe('1 report source image could not be prepared.');
  });

  it('has no on-screen preview either, rather than the whole sheet', async () => {
    storeSheet(4000, 3000);
    fakeMedia.deviceCannotOpen.add(SHEET_URI);
    await expect(renderNativeReportDrawingPreview(reference(TOP_RIGHT))).rejects.toThrow(NOT_CROPPED);
    expect([...fakeMedia.files.keys()]).toEqual([SHEET_URI]);
  });

  it('names the type, and keeps the plain "not a picture" words for a file that is no picture at all', () => {
    expect(reportDrawingNotCroppedMessage('png')).toBe(
      'The PNG drawing could not be cropped on this device. ' +
      'If it was saved for print (CMYK) or as 16-bit grey, save it again as an ordinary colour picture.',
    );
    expect(reportDrawingNotCroppedMessage('webp')).toBe('The WebP image could not be prepared for the Word report.');
    expect(reportDrawingNotCroppedMessage('unknown')).toBe('This file is not a picture the Word report can use. It was left out.');
  });
});

describe('a drawing record with no file path (review pass 2 W4)', () => {
  const NO_FILE = 'This drawing has no file on this device, so its excerpt was left out.';

  it.each<[string, unknown]>([
    ['no path at all', undefined],
    ['a null path', null],
    ['an empty path', ''],
    ['a blank path', '   '],
  ])('is listed in plain words for %s', async (_name, uri) => {
    for (const stored of [
      { mimeType: 'image/jpeg', originalFileName: 'site-plan.jpg' },
      { mimeType: 'application/pdf', originalFileName: 'site-plan.pdf' },
      { mimeType: undefined, originalFileName: undefined },
    ]) {
      const result = await native(TOP_RIGHT, { uri, ...stored });
      expect(result.media).toEqual([]);
      expect(result.unavailableMedia).toEqual([{
        id: 'ref-1',
        kind: 'drawing',
        label: '2321 Compliance Project · North Lot · Site Plan · Rev 2 · Sheet C1.0',
        reason: NO_FILE,
      }]);
    }
    expect(renderPdfExcerpt).not.toHaveBeenCalled();
    expect(fakeMedia.deviceOpened).toEqual([]);
  });

  it('has no on-screen preview, for the same reason', async () => {
    await expect(renderNativeReportDrawingPreview(reference(TOP_RIGHT, { uri: undefined }))).rejects.toThrow(NO_FILE);
    await expect(renderNativeReportDrawingPreview(reference(TOP_RIGHT, { uri: '' }))).rejects.toThrow(NO_FILE);
  });

  it('lists a photo with no file path in words too, not as a program error', async () => {
    const result = await resolveNativeReportWordMedia({
      updates: [{
        id: 'update-1',
        projectName: '2321 Compliance Project',
        photos: [{ id: 'photo-1', uri: undefined, caption: 'North lot paving' }],
      }] as never,
      reportPhotoIds: ['photo-1'],
      drawingReferences: [],
    });
    expect(result.unavailableMedia).toEqual([{
      id: 'photo-1',
      kind: 'photo',
      label: 'Photo 1 — North lot paving',
      reason: 'The local image path is missing.',
    }]);
  });
});

describe('the same citation on the phone and on the desktop', () => {
  it.each<[string, Region, number, number, string]>([
    ['a quarter of a landscape sheet', TOP_RIGHT, 4000, 3000, 'B'],
    ['a quarter of an upright sheet', TOP_RIGHT, 3000, 4000, 'B'],
    ['the top-left corner', { x: 0, y: 0, width: 0.2, height: 0.2 }, 4000, 3000, 'A'],
    ['the bottom-right corner', { x: 0.8, y: 0.8, width: 0.2, height: 0.2 }, 4000, 3000, 'D'],
    ['an area hanging off the bottom edge', { x: 0.1, y: 0.9, width: 0.2, height: 0.4 }, 4000, 3000, 'C'],
    ['an area across the middle', { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 4000, 3000, 'ABCD'],
    ['a sheet small enough to keep at full size', { x: 0.55, y: 0.55, width: 0.3, height: 0.3 }, 1200, 900, 'D'],
    ['an area large enough to be scaled down', { x: 0, y: 0, width: 1, height: 1 }, 4000, 3000, 'ABCD'],
  ])('shows the same part of the sheet for %s', async (_name, region, width, height, labels) => {
    storeSheet(width, height);
    const phone = await native(region);
    const web = await desktop(region);

    expect(phone.unavailableMedia).toEqual([]);
    expect(web.unavailableMedia).toEqual([]);
    const plan = planReportDrawingCrop(region, { width, height });
    expect(fakeMedia.deviceCrops).toEqual([plan]);
    expect(fakeMedia.browserCrops).toEqual([plan]);
    expect(labelsIn(fakePictureIn(phone.media[0].data)!)).toBe(labels);
    expect(labelsIn(fakePictureIn(web.media[0].data)!)).toBe(labels);
    expect([phone.media[0].width, phone.media[0].height]).toEqual([web.media[0].width, web.media[0].height]);
  });

  it('refuses the same invalid areas on both, in the same words', async () => {
    storeSheet(4000, 3000);
    for (const region of [
      { x: Number.NaN, y: 0.1, width: 0.2, height: 0.2 },
      { x: 0.1, y: 0.1, width: 0.2, height: 0 },
      { x: 0.1, y: 1.5, width: 0.2, height: 0.2 },
    ]) {
      const phone = await native(region);
      const web = await desktop(region);
      expect(phone.media).toEqual([]);
      expect(web.media).toEqual([]);
      expect(phone.unavailableMedia.map(item => item.reason)).toEqual([REPORT_DRAWING_INVALID_REGION_MESSAGE]);
      expect(web.unavailableMedia.map(item => item.reason)).toEqual([REPORT_DRAWING_INVALID_REGION_MESSAGE]);
    }
    expect(fakeMedia.deviceCrops).toEqual([]);
    expect(fakeMedia.browserCrops).toEqual([]);
  });
});
