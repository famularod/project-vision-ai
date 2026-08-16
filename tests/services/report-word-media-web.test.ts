import {
  detectReportImageFormat,
  resolveProtectedImageWithRetry,
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
      reportMediaSources: ['missing-first', 'missing-second'].map(photoId => ({
        bucket: 'project-photos' as const,
        projectId: 'project-a',
        updateId: `update-${photoId}`,
        photoId,
        storagePath: `owner-1/project-a/${photoId}.jpg`,
        contentSha256: null,
      })),
      drawingReferences: [],
      getArtifactUrl: jest.fn(),
    });

    expect(result.unavailableMedia.map(item => item.label)).toEqual([
      'Photo 1',
      'Photo 2',
    ]);
  });

  it('does not dereference a current photo whose path differs from the approved exact receipt', async () => {
    const getArtifactUrl = jest.fn(async () => 'https://example.test/replacement');
    const result = await resolveWebReportWordMedia({
      updates: [{
        id: 'update-1',
        projectId: 'project-a',
        projectName: 'Project A',
        date: '2026-08-10T00:00:00.000Z',
        notes: '',
        recipients: { contactIds: [] },
        photos: [{
          id: 'photo-1',
          uri: '',
          caption: 'Approved evidence',
          category: 'Update',
          actionRequired: '',
          actionOwner: '',
          actionDueDate: '',
          actionStatus: 'Open',
          cloudStoragePath: 'owner-1/project-b/replacement.jpg',
        }],
      }],
      reportMediaSources: [{
        bucket: 'project-photos',
        projectId: 'project-a',
        updateId: 'update-1',
        photoId: 'photo-1',
        storagePath: 'owner-1/project-a/approved.jpg',
        contentSha256: null,
      }],
      drawingReferences: [],
      getArtifactUrl,
    });

    expect(getArtifactUrl).not.toHaveBeenCalled();
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia[0]?.reason).toMatch(/approved report source/i);
  });

  it('does not dereference report photo bytes without a canonical approved digest', async () => {
    const getArtifactUrl = jest.fn(async () => 'https://example.test/unbound');
    const result = await resolveWebReportWordMedia({
      updates: [{
        id: 'update-1',
        projectId: 'project-a',
        projectName: 'Project A',
        date: '2026-08-10T00:00:00.000Z',
        notes: '',
        recipients: { contactIds: [] },
        photos: [{
          id: 'photo-1',
          uri: '',
          caption: 'Hashless evidence',
          category: 'Update',
          actionRequired: '',
          actionOwner: '',
          actionDueDate: '',
          actionStatus: 'Open',
          cloudStoragePath: 'owner-1/project-a/photo-1.jpg',
        }],
      }],
      reportMediaSources: [{
        bucket: 'project-photos',
        projectId: 'project-a',
        updateId: 'update-1',
        photoId: 'photo-1',
        storagePath: 'owner-1/project-a/photo-1.jpg',
        contentSha256: null,
      }],
      drawingReferences: [],
      getArtifactUrl,
    });

    expect(getArtifactUrl).not.toHaveBeenCalled();
    expect(result.media).toEqual([]);
    expect(result.unavailableMedia[0]?.reason).toMatch(/digest/i);
  });

  it('rejects replacement bytes before browser image decoding when the receipt has a digest', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xdb]).buffer,
    })) as any;
    try {
      await expect(resolveProtectedImageWithRetry({
        bucket: 'project-photos',
        path: 'owner-1/project-a/photo-1.jpg',
        expectedSha256: 'a'.repeat(64),
        getArtifactUrl: jest.fn(async () => 'https://example.test/photo-1.jpg'),
      })).rejects.toThrow(/bytes no longer match the approved report source/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
