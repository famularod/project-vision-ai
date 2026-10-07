/**
 * Review pass 2, W2 (5 Oct 2026): every time a drawing preview was shown on
 * the Reports screen a new JPEG was written to the cache folder, and nothing
 * removed one. There is now one preview file per drawing reference, in the
 * app's own folder, reused while the drawing is unchanged and removed when a
 * new one replaces it. A file still on screen is never removed.
 * Each test starts the module afresh, as a newly opened app would.
 */
import { planReportDrawingCrop } from '../../services/ReportDrawingCrop';
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';

jest.mock('expo-file-system', () => require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-image-manipulator', () => require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition', () => ({ renderPdfExcerpt: jest.fn() }));

type Fakes = typeof import('../fixtures/report-word-media-fakes');
type Region = { x: number; y: number; width: number; height: number };

const FOLDER = 'file:///cache/report-drawing-previews/';
const TOP_RIGHT: Region = { x: 0.6, y: 0.1, width: 0.3, height: 0.3 };
const BOTTOM_LEFT: Region = { x: 0.1, y: 0.6, width: 0.3, height: 0.3 };

/** The picture a preview shows: a kept file, or the picture itself handed over as data. */
function previewBytes(fakes: Fakes, uri: string): Uint8Array | null {
  if (uri.startsWith('data:')) return Uint8Array.from(Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'));
  return fakes.fakeMedia.files.get(uri) ?? null;
}

/**
 * Every app opened by a test. Review pass 1, L6: the image tool holds a picture
 * until it is released, as the real one does, so each is checked afterwards.
 */
const opened: Fakes[] = [];
afterEach(() => {
  for (const fakes of opened.splice(0)) fakes.expectFakeDeviceLetGoOfEveryPicture();
});

/**
 * The preview function and the phone's files, as in an app that has just been
 * opened. `disk`: what an earlier run of the app left on the phone.
 */
function openApp(disk?: Fakes['fakeMedia']) {
  let fakes!: Fakes;
  let preview!: (reference: ReportDrawingReference) => Promise<string>;
  let renderPdf!: jest.Mock;
  jest.isolateModules(() => {
    fakes = require('../fixtures/report-word-media-fakes');
    preview = require('../../services/ReportWordMedia.native').renderNativeReportDrawingPreview;
    renderPdf = require('../../modules/dave-text-recognition').renderPdfExcerpt;
  });
  opened.push(fakes);
  const { fakeMedia, fakeImageBytes, fakePictureIn, labelsIn, quadrantSheet } = fakes;
  if (disk) {
    // The files outlive the app; what the app remembered does not.
    for (const [uri, bytes] of disk.files) fakeMedia.files.set(uri, bytes);
    for (const [uri, time] of disk.modified) fakeMedia.modified.set(uri, time);
    for (const [id, picture] of disk.pictures) fakeMedia.pictures.set(id, picture);
    fakeMedia.nextId = disk.nextId;
    fakeMedia.moveFails = disk.moveFails;
  }
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
    fakes,
    labels: (uri: string) => labelsIn(fakePictureIn(previewBytes(fakes, uri)!)!),
    /** The app is closed and opened again: same phone, nothing remembered. */
    reopened: () => openApp(fakeMedia),
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

describe('when a preview cannot be moved into the folder (review pass 3 W2r: it stayed in the image tool\'s folder for good)', () => {
  const NAMES = ['site-plan', 'grading-plan', 'utility-plan', 'paving-plan', 'storm-plan'];

  it('gives the screen the picture itself, keeps no file, and still makes it once', async () => {
    const app = openApp();
    app.fakeMedia.moveFails = true;
    const first = await app.preview(app.drawing('site-plan'));
    expect(first.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(app.labels(first)).toBe('B');
    expect(app.strays()).toEqual([]);
    expect(app.previewFiles()).toEqual([]);

    expect(await app.preview(app.drawing('site-plan'))).toBe(first);
    expect(app.fakeMedia.deviceOpened).toHaveLength(1);

    const replaced = await app.preview(app.drawing('site-plan', BOTTOM_LEFT));
    expect(replaced).not.toBe(first);
    expect(app.labels(replaced)).toBe('C');
    expect(app.strays()).toEqual([]);
  });

  it('leaves nothing behind for 5 drawings over 6 runs of the app (it was 30 files)', async () => {
    let app = openApp();
    app.fakeMedia.moveFails = true;
    for (let run = 0; run < 6; run += 1) {
      for (const name of NAMES) {
        expect(app.labels(await app.preview(app.drawing(name)))).toBe('B');
        expect(app.strays()).toEqual([]);
        expect(app.previewFiles()).toEqual([]);
      }
      app = app.reopened();
    }
  });

  it('does the same for a PDF drawing\'s preview', async () => {
    const app = openApp();
    app.fakeMedia.moveFails = true;
    const pdfUri = 'file:///documents/project-documents/site-plan.pdf';
    app.fakeMedia.files.set(pdfUri, Uint8Array.from('%PDF-1.7\n', character => character.charCodeAt(0)));
    app.renderPdf.mockImplementation(async () => {
      const uri = `file:///tmp/vitruvius-drawing-${app.fakeMedia.nextId + 1}.jpg`;
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
    const shown = await app.preview(reference);
    expect(shown.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(app.strays()).toEqual([]);
    expect(await app.preview(reference)).toBe(shown);
    expect(app.renderPdf).toHaveBeenCalledTimes(1);
  });

  it('goes back to a kept file once moving works again, with nothing left over from before', async () => {
    const app = openApp();
    app.fakeMedia.moveFails = true;
    const asData = await app.preview(app.drawing('site-plan'));
    app.fakeMedia.moveFails = false;
    // Unchanged: the picture already made is used.
    expect(await app.preview(app.drawing('site-plan'))).toBe(asData);
    // Changed: the new one is kept as a file in the folder.
    const asFile = await app.preview(app.drawing('site-plan', BOTTOM_LEFT));
    expect(asFile.startsWith(FOLDER)).toBe(true);
    expect(app.previewFiles()).toEqual([asFile]);
    expect(app.strays()).toEqual([]);
    // And a file replaced by a picture handed over as data is removed as any replaced file is.
    app.fakeMedia.moveFails = true;
    const again = await app.preview(app.drawing('site-plan'));
    expect(again.startsWith('data:')).toBe(true);
    expect(app.previewFiles()).toEqual([]);
    expect(app.strays()).toEqual([]);
  });

  it('shows no preview, and still leaves no file, when the picture that was made is not a JPEG or a PNG', async () => {
    const app = openApp();
    app.fakeMedia.moveFails = true;
    app.fakeMedia.deviceWrites = 'webp';
    await expect(app.preview(app.drawing('site-plan'))).rejects.toThrow('not a JPEG or a PNG');
    expect(app.strays()).toEqual([]);
    expect(app.previewFiles()).toEqual([]);
  });

  it('never removes a kept file that is on screen for another drawing', async () => {
    const app = openApp();
    const onScreen = await app.preview(app.drawing('grading-plan'));
    app.fakeMedia.moveFails = true;
    for (const name of NAMES.filter(candidate => candidate !== 'grading-plan')) await app.preview(app.drawing(name));
    await app.preview(app.drawing('site-plan', BOTTOM_LEFT));
    expect(app.previewFiles()).toEqual([onScreen]);
    expect(app.labels(onScreen)).toBe('B');
    expect(app.strays()).toEqual([]);
  });
});

/** A small repeatable random number source. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('holds over 150 random sequences in which moving fails and works by turns and the app is reopened', async () => {
  const NAMES = ['site', 'grading', 'utility', 'paving', 'storm'];
  let mostFiles = 0;
  for (let seed = 1; seed <= 150; seed += 1) {
    const random = seeded(seed);
    const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)];
    const area = (): Region => ({ x: random() * 0.7, y: random() * 0.7, width: 0.05 + random() * 0.2, height: 0.05 + random() * 0.2 });
    let app = openApp();
    const versions = new Map(NAMES.map(name => [name, 1]));
    const areas = new Map(NAMES.map(name => [name, area()]));
    let clock = 1_760_000_000_000;
    const save = (name: string) => {
      const version = versions.get(name)!;
      const uri = `file:///documents/project-documents/${name}.jpg`;
      app.fakeMedia.files.set(uri, app.fakes.fakeImageBytes('jpeg', {
        width: 4000, height: 3000, labelAt: (x: number, y: number) => `${name}#${version}|${x},${y}`,
      }));
      clock += 1_000;
      app.fakeMedia.modified.set(uri, clock);
    };
    NAMES.forEach(save);
    /** What each preview on the Reports screen is showing now. */
    const onScreen = new Map<string, string>();
    const trail: string[] = [];
    const fail = (text: string): never => { throw new Error(`seed ${seed}: ${text}\n  ${trail.slice(-10).join('\n  ')}`); };

    const show = async (name: string) => {
      onScreen.delete(name); // the preview lets go of its picture, then asks
      const uri = await app.preview(app.drawing(name, areas.get(name)!, `2321:North Lot:${name}`));
      onScreen.set(name, uri);
      const bytes = previewBytes(app.fakes, uri);
      if (!bytes) return fail(`the preview handed out for ${name} is not there`);
      const [source, at] = app.fakes.fakePictureIn(bytes)!.labelAt(0, 0).split('|');
      if (source !== `${name}#${versions.get(name)}`) fail(`stale or wrong drawing shown for ${name}: ${source}`);
      const [x, y] = at.split(',').map(Number);
      const crop = planReportDrawingCrop(areas.get(name)!, { width: 4000, height: 3000 });
      if (x !== crop.originX || y !== crop.originY) fail(`stale area shown for ${name}`);
    };

    for (let step = 0; step < 60; step += 1) {
      const roll = random();
      const name = pick(NAMES);
      if (roll < 0.45) {
        trail.push(`show ${name}`);
        await show(name);
      } else if (roll < 0.57) {
        trail.push(`the cited area of ${name} changes, then it is shown`);
        areas.set(name, area());
        await show(name);
      } else if (roll < 0.69) {
        trail.push(`the file of ${name} is replaced, then it is shown`);
        versions.set(name, versions.get(name)! + 1);
        save(name);
        await show(name);
      } else if (roll < 0.76) {
        trail.push(`leave the Reports screen (${name} no longer shown)`);
        onScreen.delete(name);
      } else if (roll < 0.90) {
        app.fakeMedia.moveFails = !app.fakeMedia.moveFails;
        trail.push(`moving into the preview folder ${app.fakeMedia.moveFails ? 'starts failing' : 'works again'}`);
      } else {
        trail.push('the app is closed and opened again');
        app = app.reopened();
        onScreen.clear();
      }
      // Nothing is ever left where the image tool writes, whether moving works or not.
      if (app.strays().length) fail(`${app.strays().length} file(s) left in the image tool's folder`);
      // A kept file that is on screen is still there, and no two drawings share one.
      const files = [...onScreen.values()].filter(uri => !uri.startsWith('data:'));
      for (const uri of files) if (!app.fakeMedia.files.has(uri)) fail(`a preview on screen was removed (${uri})`);
      if (new Set(files).size !== files.length) fail('two drawings share one preview file');
      if (app.previewFiles().length > NAMES.length) fail(`${app.previewFiles().length} kept files for ${NAMES.length} drawings`);
      mostFiles = Math.max(mostFiles, app.previewFiles().length + app.strays().length);
    }
  }
  expect(mostFiles).toBeLessThanOrEqual(5);
}, 120_000);

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
