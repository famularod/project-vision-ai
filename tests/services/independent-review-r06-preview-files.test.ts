/**
 * Review pass 2, W2 (5 Oct 2026): every time a drawing preview was shown on
 * the Reports screen a new JPEG was written to the cache folder, and nothing
 * removed one. There is now one preview file per drawing reference, in the
 * app's own folder, reused while the drawing is unchanged and removed when a
 * new one replaces it. A file still on screen is never removed.
 * Each test starts the module afresh, as a newly opened app would.
 */
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';

jest.mock('expo-file-system', () => require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-image-manipulator', () => require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition', () => ({ renderPdfExcerpt: jest.fn() }));

type Fakes = typeof import('../fixtures/report-word-media-fakes');
type Region = { x: number; y: number; width: number; height: number };

const FOLDER = 'file:///cache/report-drawing-previews/';
const TOP_RIGHT: Region = { x: 0.6, y: 0.1, width: 0.3, height: 0.3 };
const BOTTOM_LEFT: Region = { x: 0.1, y: 0.6, width: 0.3, height: 0.3 };

/** The preview function and the phone's files, as in an app that has just been opened. */
function openApp() {
  let fakes!: Fakes;
  let preview!: (reference: ReportDrawingReference) => Promise<string>;
  let renderPdf!: jest.Mock;
  jest.isolateModules(() => {
    fakes = require('../fixtures/report-word-media-fakes');
    preview = require('../../services/ReportWordMedia.native').renderNativeReportDrawingPreview;
    renderPdf = require('../../modules/dave-text-recognition').renderPdfExcerpt;
  });
  const { fakeMedia, fakeImageBytes, fakePictureIn, labelsIn, quadrantSheet } = fakes;
  const all = () => [...fakeMedia.files.keys()];
  return {
    fakeMedia,
    preview,
    renderPdf,
    /** Saves a picture drawing on the phone and returns a reference citing an area of it. */
    drawing(name: string, region: Region = TOP_RIGHT, id = name): ReportDrawingReference {
      const uri = `file:///documents/project-documents/${name}.jpg`;
      if (!fakeMedia.files.has(uri)) fakeMedia.files.set(uri, fakeImageBytes('jpeg', quadrantSheet(4000, 3000)));
      const citation = { documentId: name, pageNumber: 1, label: `${name} · Sheet C1.0` };
      return {
        id,
        projectName: '2321 Compliance Project',
        areaName: 'North Lot',
        citation,
        excerpt: { document: { id: name, name, originalFileName: `${name}.jpg`, mimeType: 'image/jpeg', uri }, pageNumber: 1, region, citation },
      } as unknown as ReportDrawingReference;
    },
    labels: (uri: string) => labelsIn(fakePictureIn(fakeMedia.files.get(uri)!)!),
    previewFiles: () => all().filter(uri => uri.startsWith(FOLDER)),
    /** Anything left where the image tool or the PDF renderer writes. */
    strays: () => all().filter(uri => uri.startsWith('file:///cache/ImageManipulator/') || uri.startsWith('file:///tmp/')),
    quadrantBytes: () => fakeImageBytes('jpeg', quadrantSheet(4000, 3000)),
  };
}

it('shows one drawing ten times and leaves one preview file, made once', async () => {
  const app = openApp();
  const reference = app.drawing('site-plan');
  const shown: string[] = [];
  for (let visit = 0; visit < 10; visit += 1) shown.push(await app.preview(reference));

  expect(new Set(shown).size).toBe(1);
  expect(shown[0].startsWith(FOLDER)).toBe(true);
  expect(app.labels(shown[0])).toBe('B');
  expect(app.previewFiles()).toEqual([shown[0]]);
  expect(app.strays()).toEqual([]);
  // The sheet was opened and cropped once, not ten times.
  expect(app.fakeMedia.deviceOpened).toHaveLength(1);
});

it('keeps one file for each drawing reference, and never removes one that is on screen', async () => {
  const app = openApp();
  const first = await app.preview(app.drawing('site-plan'));
  const second = await app.preview(app.drawing('grading-plan'));
  const third = await app.preview(app.drawing('utility-plan'));
  expect(new Set([first, second, third]).size).toBe(3);
  // All three are on the Reports screen together: all three files are still there.
  expect(app.previewFiles().sort()).toEqual([first, second, third].sort());
  // Showing them again, in any order, changes nothing.
  expect(await app.preview(app.drawing('grading-plan'))).toBe(second);
  expect(await app.preview(app.drawing('site-plan'))).toBe(first);
  expect(app.previewFiles().sort()).toEqual([first, second, third].sort());
  expect(app.strays()).toEqual([]);
});

it.each<[string, (app: ReturnType<typeof openApp>) => ReportDrawingReference, string]>([
  ['the cited area changes', app => app.drawing('site-plan', BOTTOM_LEFT), 'C'],
  ['the drawing file is replaced', app => {
    app.fakeMedia.files.set('file:///documents/project-documents/site-plan.jpg', app.quadrantBytes());
    app.fakeMedia.modified.set('file:///documents/project-documents/site-plan.jpg', 1_760_000_000_000);
    return app.drawing('site-plan');
  }, 'B'],
])('makes a new preview when %s, and removes the one it replaces', async (_name, change, labels) => {
  const app = openApp();
  const before = await app.preview(app.drawing('site-plan'));
  const other = await app.preview(app.drawing('grading-plan'));

  const after = await app.preview(change(app));
  expect(after).not.toBe(before);
  expect(app.labels(after)).toBe(labels);
  // The replaced file is gone; the other drawing's file, still on screen, is not touched.
  expect(app.fakeMedia.files.has(before)).toBe(false);
  expect(app.previewFiles().sort()).toEqual([other, after].sort());
  expect(app.strays()).toEqual([]);
});

it('makes one picture when the same preview is asked for twice at once', async () => {
  const app = openApp();
  const reference = app.drawing('site-plan');
  const [first, second] = await Promise.all([app.preview(reference), app.preview(reference)]);
  expect(second).toBe(first);
  expect(app.previewFiles()).toEqual([first]);
  expect(app.fakeMedia.deviceOpened).toHaveLength(1);
});

it('clears previews left by an earlier run of the app, once, before any of this run are made', async () => {
  const app = openApp();
  const leftovers = [`${FOLDER}preview-1759000000000-1.jpg`, `${FOLDER}preview-1759000000000-2.jpg`];
  for (const uri of leftovers) app.fakeMedia.files.set(uri, app.quadrantBytes());
  // Other things in the cache are not this folder's business.
  const unrelated = 'file:///cache/ImageManipulator/someone-elses.jpg';
  app.fakeMedia.files.set(unrelated, app.quadrantBytes());

  const first = await app.preview(app.drawing('site-plan'));
  expect(app.previewFiles()).toEqual([first]);
  expect(app.fakeMedia.files.has(unrelated)).toBe(true);

  // A file that turns up in the folder later in this run is not cleared: the clearing happens once.
  const second = await app.preview(app.drawing('grading-plan'));
  expect(app.previewFiles().sort()).toEqual([first, second].sort());
});

it('keeps a PDF drawing\'s preview the same way', async () => {
  const app = openApp();
  const pdfUri = 'file:///documents/project-documents/site-plan.pdf';
  app.fakeMedia.files.set(pdfUri, Uint8Array.from('%PDF-1.7\n', character => character.charCodeAt(0)));
  let rendered = 0;
  app.renderPdf.mockImplementation(async () => {
    rendered += 1;
    const uri = `file:///tmp/vitruvius-drawing-${rendered}.jpg`;
    app.fakeMedia.files.set(uri, app.quadrantBytes());
    return { uri, width: 800, height: 600 };
  });
  const reference = {
    ...app.drawing('site-plan'),
    excerpt: {
      ...app.drawing('site-plan').excerpt,
      document: { id: 'site-plan', name: 'Site Plan', originalFileName: 'site-plan.pdf', mimeType: 'application/pdf', uri: pdfUri },
    },
  } as unknown as ReportDrawingReference;

  const shown = [await app.preview(reference), await app.preview(reference), await app.preview(reference)];
  expect(new Set(shown).size).toBe(1);
  expect(rendered).toBe(1);
  expect(app.previewFiles()).toEqual([shown[0]]);
  expect(app.strays()).toEqual([]);
});

it('still shows the preview when it cannot be moved into the folder, and still keeps only one', async () => {
  const app = openApp();
  app.fakeMedia.moveFails = true;
  const first = await app.preview(app.drawing('site-plan'));
  expect(app.labels(first)).toBe('B');
  expect(await app.preview(app.drawing('site-plan'))).toBe(first);

  const replaced = await app.preview(app.drawing('site-plan', BOTTOM_LEFT));
  expect(app.labels(replaced)).toBe('C');
  expect(app.fakeMedia.files.has(first)).toBe(false);
  expect(app.strays()).toEqual([replaced]);
});

it('makes the preview again if its file has gone', async () => {
  const app = openApp();
  const first = await app.preview(app.drawing('site-plan'));
  // iOS emptied the cache while the app was in the background.
  app.fakeMedia.files.delete(first);
  const again = await app.preview(app.drawing('site-plan'));
  expect(app.labels(again)).toBe('B');
  expect(app.previewFiles()).toEqual([again]);
});

it('leaves nothing behind when the preview cannot be made', async () => {
  const app = openApp();
  await expect(app.preview(app.drawing('site-plan', { x: 0.6, y: 0.1, width: 0, height: 0.3 })))
    .rejects.toThrow('The cited drawing area has invalid coordinates.');
  expect(app.previewFiles()).toEqual([]);
  expect(app.strays()).toEqual([]);
  // And a good one afterwards is made as usual.
  const shown = await app.preview(app.drawing('site-plan'));
  expect(app.previewFiles()).toEqual([shown]);
});
