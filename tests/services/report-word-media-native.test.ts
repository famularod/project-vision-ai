const mockFile = jest.fn();
let mockFileBytes = new Uint8Array([1, 2, 3]);
jest.mock('expo-file-system', () => ({
  File: class MockFile {
    exists = true;
    uri: string;
    constructor(mockUri: string) {
      this.uri = mockUri;
      mockFile(mockUri);
    }
    async bytes() {
      return mockFileBytes;
    }
    delete() {}
  },
}));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));
import { Image } from 'react-native';
import {
  renderNativeReportDrawingPreview,
  resolveNativeReportWordMedia,
} from '../../services/ReportWordMedia.native';

const mockGetSize = jest.spyOn(Image, 'getSize').mockImplementation((
  _uri: string,
  success: (width: number, height: number) => void,
) => success(800, 600));

function drawingReference(mimeType: string, uri: string, fileName: string) {
  return {
    id: 'drawing-proof-1',
    projectName: 'Project 2375',
    areaName: 'Electrical',
    citation: { label: 'E-2.7, page 13' },
    excerpt: {
      pageNumber: 13,
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
      document: {
        id: 'drawing-1',
        uri,
        mimeType,
        originalFileName: fileName,
        name: fileName,
      },
    },
  } as never;
}

describe('native report drawing proof containment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileBytes = new Uint8Array([1, 2, 3]);
  });

  it('fails closed for PDF report media without entering a native file decoder', async () => {
    const reference = drawingReference(
      'application/pdf',
      'file:///drawing.pdf',
      'drawing.pdf',
    );

    const result = await resolveNativeReportWordMedia({
      updates: [],
      reportPhotoIds: [],
      drawingReferences: [reference],
    });

    expect(result.media).toEqual([]);
    expect(result.unavailableMedia).toHaveLength(1);
    expect(result.unavailableMedia[0].reason).toMatch(/protected desktop renderer/i);
    await expect(renderNativeReportDrawingPreview(reference))
      .rejects.toThrow(/protected desktop renderer/i);

    const mimeConfusedReference = drawingReference(
      'image/png',
      'file:///drawing.pdf?download=1',
      'drawing.png',
    );
    const confusedResult = await resolveNativeReportWordMedia({
      updates: [],
      reportPhotoIds: [],
      drawingReferences: [mimeConfusedReference],
    });
    expect(confusedResult.media).toEqual([]);
    expect(confusedResult.unavailableMedia[0].reason)
      .toMatch(/protected desktop renderer/i);
    await expect(renderNativeReportDrawingPreview(mimeConfusedReference))
      .rejects.toThrow(/protected desktop renderer/i);
    expect(mockFile).not.toHaveBeenCalled();
  });

  it('rejects PDF signature bytes before a MIME-confused native image decoder', async () => {
    mockFileBytes = new Uint8Array([
      0, 0, 0,
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37,
    ]);
    const reference = drawingReference(
      'image/png',
      'file:///drawing.png',
      'drawing.png',
    );

    const result = await resolveNativeReportWordMedia({
      updates: [],
      reportPhotoIds: [],
      drawingReferences: [reference],
    });

    expect(result.media).toEqual([]);
    expect(result.unavailableMedia[0].reason)
      .toMatch(/protected desktop renderer/i);
    await expect(renderNativeReportDrawingPreview(reference))
      .rejects.toThrow(/protected desktop renderer/i);
    expect(mockGetSize).not.toHaveBeenCalled();
  });

  it('preserves supported image report media and preview', async () => {
    const reference = drawingReference(
      'image/png',
      'file:///drawing.png',
      'drawing.png',
    );

    const result = await resolveNativeReportWordMedia({
      updates: [],
      reportPhotoIds: [],
      drawingReferences: [reference],
    });

    expect(result.unavailableMedia).toEqual([]);
    expect(result.media).toMatchObject([{
      id: 'drawing-proof-1',
      kind: 'drawing',
      mimeType: 'image/png',
      width: 800,
      height: 600,
    }]);
    await expect(renderNativeReportDrawingPreview(reference))
      .resolves.toBe('file:///drawing.png');
    expect(mockGetSize).toHaveBeenCalledWith(
      'file:///drawing.png',
      expect.any(Function),
      expect.any(Function),
    );
  });
});
