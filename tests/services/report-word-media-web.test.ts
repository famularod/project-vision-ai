import {
  detectReportImageFormat,
  resolveProtectedArtifactWithRetry,
  resolveWebReportWordMedia,
} from '../../services/ReportWordMedia.web';

describe('web Word report media recovery', () => {
  it('recognizes an iPhone HEIC file even when cloud metadata calls it JPEG', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63,
      0x00, 0x00, 0x00, 0x00,
    ]);

    expect(detectReportImageFormat(bytes, 'image/jpeg')).toBe('heic');
  });

  it('recognizes a JPEG by its file signature', () => {
    expect(detectReportImageFormat(
      new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
      'application/octet-stream',
    )).toBe('jpeg');
  });

  it('requests a fresh protected URL when the first media read fails', async () => {
    const getArtifactUrl = jest
      .fn<Promise<string>, ['project-photos' | 'project-documents', string]>()
      .mockResolvedValueOnce('https://example.test/expired')
      .mockResolvedValueOnce('https://example.test/fresh');
    const render = jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValueOnce('prepared');

    await expect(resolveProtectedArtifactWithRetry({
      bucket: 'project-photos',
      path: 'photos/site.heic',
      getArtifactUrl,
      render,
    })).resolves.toBe('prepared');

    expect(getArtifactUrl).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenNthCalledWith(2, 'https://example.test/fresh');
  });

  it('keeps report photo numbers stable when an earlier source image is unavailable', async () => {
    const result = await resolveWebReportWordMedia({
      updates: [],
      reportPhotoIds: ['missing-first', 'missing-second'],
      drawingReferences: [],
      getArtifactUrl: jest.fn(),
    });

    expect(result.unavailableMedia.map(item => item.label)).toEqual([
      'Photo 1',
      'Photo 2',
    ]);
  });
});
