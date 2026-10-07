/**
 * Build 231 E1 item 5: the desktop Word report decided whether a drawing is a
 * PDF or a picture from its stored label, not its contents, so a mislabelled
 * drawing was listed as left out. It now reads the first bytes, as the phone
 * does. The real desktop resolver runs with the browser's picture I/O
 * replaced (tests/fixtures/report-word-media-fakes) and a stand-in pdf.js
 * (jest cannot run the real one's import).
 */
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';
import { reportImageNotPreparedMessage } from '../../services/ReportWordImageFormat';
import { resolveWebReportWordMedia } from '../../services/ReportWordMedia.web';
import {
  FAKE_SIGNATURES,
  fakeImageBytes,
  fakeMedia,
  fakePictureIn,
  installFakeBrowser,
  labelsIn,
  quadrantSheet,
} from '../fixtures/report-word-media-fakes';

type Region = { x: number; y: number; width: number; height: number };

const URL_OF_FILE = 'https://cloud.example.test/project-documents/site-plan';
/** Sits wholly inside the top-right quarter (B on the labelled sheet), margin included. */
const TOP_RIGHT: Region = { x: 0.6, y: 0.1, width: 0.3, height: 0.3 };
const PDF_BYTES = new Uint8Array([...FAKE_SIGNATURES.pdf, 1, 2, 3, 4, 5, 6, 7]);

function reference(document: Record<string, unknown>, pageNumber = 3): ReportDrawingReference {
  const citation = { documentId: 'site-plan', label: 'Site Plan · Rev 2 · Sheet C1.0' };
  return {
    id: 'ref-1',
    projectName: '2321 Compliance Project',
    areaName: 'North Lot',
    citation,
    excerpt: {
      document: { id: 'site-plan', name: 'Site Plan', storagePath: 'owner/site-plan', ...document },
      pageNumber,
      region: TOP_RIGHT,
      citation,
    },
  } as unknown as ReportDrawingReference;
}

/** A stand-in pdf.js: every page is a 1000 x 800 point sheet drawn as the four labelled quarters. */
function standInPdfJs() {
  const opened: Array<{ bytes: number[]; pages: number[] }> = [];
  const pdfJs = {
    GlobalWorkerOptions: {} as { workerSrc?: string },
    getDocument: ({ data }: { data: Uint8Array }) => {
      const record = { bytes: Array.from(data), pages: [] as number[] };
      opened.push(record);
      return {
        promise: Promise.resolve({
          numPages: 5,
          getPage: async (pageNumber: number) => {
            record.pages.push(pageNumber);
            return {
              getViewport: ({ scale }: { scale: number }) => ({ width: 1000 * scale, height: 800 * scale }),
              render: ({ canvas }: { canvas: { width: number; height: number; picture: unknown } }) => {
                canvas.picture = quadrantSheet(canvas.width, canvas.height);
                return { promise: Promise.resolve() };
              },
            };
          },
        }),
      };
    },
  };
  return { opened, load: jest.fn(async () => pdfJs as never) };
}

const desktop = (document: Record<string, unknown>, loadPdfJs: ReturnType<typeof standInPdfJs>['load']) =>
  resolveWebReportWordMedia({
    updates: [],
    reportPhotoIds: [],
    drawingReferences: [reference(document)],
    getArtifactUrl: async () => URL_OF_FILE,
    loadPdfJs,
  });

let restoreBrowser: () => void = () => undefined;
beforeEach(() => {
  fakeMedia.reset();
  restoreBrowser = installFakeBrowser();
});
afterEach(() => restoreBrowser());

describe('E1 item 5: the desktop reads a drawing\'s first bytes to tell a PDF from a picture', () => {
  it('a PDF stored with a picture label is rendered as a PDF and cropped (was listed as left out)', async () => {
    fakeMedia.remote.set(URL_OF_FILE, { bytes: PDF_BYTES, contentType: 'image/jpeg' });
    const pdf = standInPdfJs();
    const result = await desktop({ originalFileName: 'site-plan.jpg', mimeType: 'image/jpeg' }, pdf.load);

    expect(result.unavailableMedia).toEqual([]);
    expect(pdf.opened).toEqual([{ bytes: Array.from(PDF_BYTES), pages: [3] }]);
    expect(result.media).toHaveLength(1);
    expect(result.media[0]).toMatchObject({ kind: 'drawing', mimeType: 'image/jpeg' });
    expect(labelsIn(fakePictureIn(result.media[0].data as Uint8Array)!)).toBe('B');
  });

  it('a picture stored with a PDF label is cropped as a picture, and pdf.js is not loaded (was listed as left out)', async () => {
    fakeMedia.remote.set(URL_OF_FILE, { bytes: fakeImageBytes('png', quadrantSheet(1000, 800)), contentType: 'application/pdf' });
    const pdf = standInPdfJs();
    const result = await desktop({ originalFileName: 'site-plan.pdf', mimeType: 'application/pdf' }, pdf.load);

    expect(result.unavailableMedia).toEqual([]);
    expect(pdf.load).not.toHaveBeenCalled();
    expect(result.media).toHaveLength(1);
    expect(labelsIn(fakePictureIn(result.media[0].data as Uint8Array)!)).toBe('B');
    expect(fakeMedia.browserCrops).toHaveLength(1);
  });

  it('asks the stored type and name only when the bytes are none it recognises', async () => {
    const unknown = new Uint8Array(FAKE_SIGNATURES.unknown);
    fakeMedia.remote.set(URL_OF_FILE, { bytes: unknown, contentType: null });

    const byType = standInPdfJs();
    expect((await desktop({ originalFileName: 'scan.bin', mimeType: 'application/pdf' }, byType.load)).media).toHaveLength(1);
    expect(byType.opened).toHaveLength(1);

    // The name alone is enough, as on the phone (was: a stored type that is not "pdf" decided).
    const byName = standInPdfJs();
    expect((await desktop({ originalFileName: 'SCAN.PDF', mimeType: 'application/octet-stream' }, byName.load)).media).toHaveLength(1);
    expect(byName.opened).toHaveLength(1);

    const neither = standInPdfJs();
    const result = await desktop({ originalFileName: 'scan.bin', mimeType: 'application/octet-stream' }, neither.load);
    expect(neither.load).not.toHaveBeenCalled();
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia).toEqual([expect.objectContaining({
      kind: 'drawing',
      reason: reportImageNotPreparedMessage('unknown'),
    })]);
  });

  it('a PDF labelled a PDF and a picture labelled a picture are still read as what they are', async () => {
    fakeMedia.remote.set(URL_OF_FILE, { bytes: PDF_BYTES, contentType: 'application/pdf' });
    const pdf = standInPdfJs();
    const asPdf = await desktop({ originalFileName: 'site-plan.pdf', mimeType: 'application/pdf' }, pdf.load);
    expect(asPdf.unavailableMedia).toEqual([]);
    expect(pdf.opened).toHaveLength(1);

    fakeMedia.remote.set(URL_OF_FILE, { bytes: fakeImageBytes('jpeg', quadrantSheet(1000, 800)), contentType: 'image/jpeg' });
    const none = standInPdfJs();
    const asPicture = await desktop({ originalFileName: 'site-plan.jpg', mimeType: 'image/jpeg' }, none.load);
    expect(asPicture.unavailableMedia).toEqual([]);
    expect(none.load).not.toHaveBeenCalled();
    expect(labelsIn(fakePictureIn(asPicture.media[0].data as Uint8Array)!)).toBe('B');
  });

  // Guard: this already holds on 594a71d.
  it('a drawing that cannot be downloaded is listed with the reason', async () => {
    const pdf = standInPdfJs();
    const result = await desktop({ originalFileName: 'site-plan.pdf', mimeType: 'application/pdf' }, pdf.load);
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia).toEqual([expect.objectContaining({ reason: 'Drawing download failed (404).' })]);
  });
});
