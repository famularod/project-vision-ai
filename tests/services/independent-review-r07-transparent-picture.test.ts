/**
 * Review pass 4, L5 (5 Oct 2026; already so in Build 229): in the desktop
 * Word report a picture with a transparent background came out on black. The
 * desktop draws every picture on a canvas and saves a JPEG, and a canvas
 * saved as a JPEG puts its transparent areas on black. The phone's image tool
 * puts them on white. The desktop now puts the picture on white first.
 *
 * The stand-ins model both rules: the canvas flattens to black (the HTML
 * rule, reasoned, not run in a browser), Apple's JPEG encoder to white (run
 * on macOS ImageIO by the pass-4 reviewer).
 */
import JSZip from 'jszip';
import { Image } from 'react-native';
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';
import { buildReportWordBase64 } from '../../services/ReportWordDocument';
import { resolveNativeReportWordMedia } from '../../services/ReportWordMedia.native';
import { resolveWebReportWordMedia } from '../../services/ReportWordMedia.web';
import type { ProjectUpdate } from '../../types';
import {
  FAKE_TRANSPARENT,
  expectFakeDeviceLetGoOfEveryPicture,
  fakeFormatOf,
  fakeImageBytes,
  fakeImageGetSize,
  fakeLabelsOf,
  fakeMedia,
  fakePictureIn,
  inkOnTransparent,
  installFakeBrowser,
  quadrantSheet,
  type FakeImageFormat,
  type FakePicture,
} from '../fixtures/report-word-media-fakes';

jest.mock('expo-file-system', () => require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-image-manipulator', () => require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition', () => ({ renderPdfExcerpt: jest.fn() }));

const LOCAL = 'file:///documents/project-files/stamp';
const CLOUD = 'https://cloud.example.test/project-files/stamp';
/** An area that takes in some ink and some of the transparent background. */
const REGION = { x: 0.2, y: 0.1, width: 0.5, height: 0.5 };

/** Puts the same picture on the phone and in the cloud, and returns its bytes. */
function store(format: FakeImageFormat, picture: FakePicture) {
  const bytes = fakeImageBytes(format, picture);
  fakeMedia.files.set(LOCAL, bytes);
  fakeMedia.remote.set(CLOUD, { bytes, contentType: `image/${format}` });
  return bytes;
}

const update = {
  id: 'update-1',
  projectName: '2321 Compliance Project',
  selectedAreaName: 'North Lot',
  photos: [{ id: 'photo-1', uri: LOCAL, caption: 'Inspection stamp', cloudStoragePath: 'stamp' }],
} as unknown as ProjectUpdate;

const drawing = (() => {
  const citation = { documentId: 'stamp', label: 'Site Plan · Sheet C1.0' };
  return {
    id: 'ref-1',
    projectName: '2321 Compliance Project',
    areaName: 'North Lot',
    citation,
    excerpt: {
      document: { id: 'stamp', name: 'Site Plan', originalFileName: 'site-plan.png', mimeType: 'image/png', uri: LOCAL, storagePath: 'stamp' },
      pageNumber: 1,
      region: REGION,
      citation,
    },
  } as unknown as ReportDrawingReference;
})();

const phonePhoto = () => resolveNativeReportWordMedia({ updates: [update], reportPhotoIds: ['photo-1'], drawingReferences: [] });
const phoneDrawing = () => resolveNativeReportWordMedia({ updates: [], reportPhotoIds: [], drawingReferences: [drawing] });
const desktopPhoto = () => resolveWebReportWordMedia({ updates: [update], reportPhotoIds: ['photo-1'], drawingReferences: [], getArtifactUrl: async () => CLOUD });
const desktopDrawing = () => resolveWebReportWordMedia({ updates: [], reportPhotoIds: [], drawingReferences: [drawing], getArtifactUrl: async () => CLOUD });
const shown = (data: Uint8Array) => fakeLabelsOf(fakePictureIn(data)!);

let restoreBrowser: () => void = () => undefined;
beforeEach(() => {
  fakeMedia.reset();
  restoreBrowser = installFakeBrowser();
  jest.spyOn(Image, 'getSize').mockImplementation(fakeImageGetSize as never);
});
afterEach(() => {
  restoreBrowser();
  jest.restoreAllMocks();
  // Review pass 1, L6: the image tool holds a picture until it is released, as the real one does.
  expectFakeDeviceLetGoOfEveryPicture();
});

describe('a picture with a transparent background, in the desktop Word report', () => {
  it.each<FakeImageFormat>(['png', 'webp', 'gif'])('puts a %s photo on white, not black', async format => {
    store(format, inkOnTransparent(800, 600));
    const result = await desktopPhoto();
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media[0].mimeType).toBe('image/jpeg');
    expect(fakeFormatOf(result.media[0].data)).toBe('jpeg');
    expect(shown(result.media[0].data)).toEqual(['ink', 'white']);
  });

  it('puts a large photo that is scaled down on white too', async () => {
    store('png', inkOnTransparent(4000, 3000));
    const result = await desktopPhoto();
    expect([result.media[0].width, result.media[0].height]).toEqual([1600, 1200]);
    expect(shown(result.media[0].data)).toEqual(['ink', 'white']);
  });

  it('puts a cropped drawing on white, not black', async () => {
    store('png', inkOnTransparent(4000, 3000));
    const result = await desktopDrawing();
    expect(result.unavailableMedia).toEqual([]);
    expect(result.media[0].mimeType).toBe('image/jpeg');
    expect(shown(result.media[0].data)).toEqual(['ink', 'white']);
  });

  it('is on white whatever type the browser writes', async () => {
    fakeMedia.browserWrites = 'png';
    store('png', inkOnTransparent(800, 600));
    const result = await desktopPhoto();
    expect(result.media[0].mimeType).toBe('image/png');
    expect(shown(result.media[0].data)).toEqual(['ink', 'white']);
  });

  it('leaves a picture with no transparency exactly as it was', async () => {
    store('jpeg', quadrantSheet(800, 600));
    const photo = await desktopPhoto();
    expect(shown(photo.media[0].data)).toEqual(['A', 'B', 'C', 'D']);
    const excerpt = await desktopDrawing();
    expect(shown(excerpt.media[0].data)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('the same picture in the phone and iPad Word report', () => {
  it('keeps a PNG photo as it is, transparency included', async () => {
    const bytes = store('png', inkOnTransparent(800, 600));
    const result = await phonePhoto();
    expect(result.media[0].mimeType).toBe('image/png');
    expect(result.media[0].data).toBe(bytes);
    expect(shown(result.media[0].data)).toEqual(['ink', FAKE_TRANSPARENT]);

    // It goes into the .docx as that same PNG; Word shows the page through it.
    const archive = await JSZip.loadAsync(Buffer.from(await buildReportWordBase64({
      title: 'Project Status Report', body: 'CURRENT WORK\n- Paving is in progress.', media: result.media,
    }), 'base64'));
    const names = Object.keys(archive.files).filter(name => name.startsWith('word/media/') && !archive.files[name].dir);
    expect(names).toHaveLength(1);
    expect(names[0].endsWith('.png')).toBe(true);
    expect(Buffer.from(await archive.file(names[0])!.async('uint8array')).equals(Buffer.from(bytes))).toBe(true);
  });

  it('puts a photo it has to convert (WebP) on white', async () => {
    store('webp', inkOnTransparent(800, 600));
    const result = await phonePhoto();
    expect(result.media[0].mimeType).toBe('image/jpeg');
    expect(shown(result.media[0].data)).toEqual(['ink', 'white']);
  });

  it('puts a cropped drawing on white', async () => {
    store('png', inkOnTransparent(4000, 3000));
    const result = await phoneDrawing();
    expect(result.media[0].mimeType).toBe('image/jpeg');
    expect(shown(result.media[0].data)).toEqual(['ink', 'white']);
  });
});

it('the phone and the desktop show the same thing for the same transparent drawing and citation', async () => {
  store('png', inkOnTransparent(4000, 3000));
  const phone = await phoneDrawing();
  const web = await desktopDrawing();
  expect(fakeMedia.browserCrops).toEqual(fakeMedia.deviceCrops);
  expect(shown(web.media[0].data)).toEqual(shown(phone.media[0].data));
  expect([web.media[0].width, web.media[0].height]).toEqual([phone.media[0].width, phone.media[0].height]);
  expect(shown(web.media[0].data)).not.toContain('black');
});
