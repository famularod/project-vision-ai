import {
  ReferenceDocumentByteRestoreError,
  restoreVerifiedReferenceDocumentBytes,
  type ReferenceDocumentByteRestoreDependencies,
} from '../../services/ReferenceDocumentByteRestore';

const BYTES = new Uint8Array([1, 2, 3, 4]);
const SHA = 'a'.repeat(64);

function fixture(overrides: Partial<ReferenceDocumentByteRestoreDependencies> = {}) {
  let saved = new Uint8Array();
  const dependencies: ReferenceDocumentByteRestoreDependencies = {
    downloadBytes: jest.fn(async () => BYTES),
    createOwnedDestination: jest.fn(async () => 'file:///owned/document.pdf'),
    writeBytes: jest.fn(async (_uri, bytes) => {
      saved = new Uint8Array(bytes);
    }),
    readBytes: jest.fn(async () => saved),
    deleteFile: jest.fn(async () => undefined),
    sha256: jest.fn(async () => SHA),
    ...overrides,
  };
  return dependencies;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    documentId: 'document-1',
    storagePath: 'mobile/document-1/document.pdf',
    originalFileName: 'document.pdf',
    expectedSizeBytes: BYTES.byteLength,
    expectedSha256: SHA,
    ...overrides,
  };
}

describe('verified reference-document byte restore', () => {
  it('downloads, verifies, writes, and re-verifies an app-owned copy', async () => {
    const dependencies = fixture();

    await expect(restoreVerifiedReferenceDocumentBytes(input(), dependencies))
      .resolves.toEqual({
        documentId: 'document-1',
        uri: 'file:///owned/document.pdf',
        bucket: 'project-documents',
        storagePath: 'mobile/document-1/document.pdf',
        sizeBytes: 4,
        sha256: SHA,
      });

    expect(dependencies.writeBytes).toHaveBeenCalledTimes(1);
    expect(dependencies.readBytes).toHaveBeenCalledTimes(1);
    expect(dependencies.deleteFile).not.toHaveBeenCalled();
  });

  it.each([
    { expectedSizeBytes: 0 },
    { expectedSha256: '' },
    { expectedSha256: 'A'.repeat(64) },
  ])('fails closed when integrity metadata is missing or malformed', async override => {
    const dependencies = fixture();

    await expect(restoreVerifiedReferenceDocumentBytes(input(override), dependencies))
      .rejects.toMatchObject({ code: 'missing_integrity_metadata' });
    expect(dependencies.downloadBytes).not.toHaveBeenCalled();
  });

  it.each([
    '../secret.pdf',
    '%2e%2e%2fsecret.pdf',
    '%252e%252e%252fsecret.pdf',
    '/tmp/secret.pdf',
    'file:///tmp/secret.pdf',
    'mobile\\secret.pdf',
  ])('rejects unsafe protected-storage path %p', async storagePath => {
    const dependencies = fixture();

    await expect(restoreVerifiedReferenceDocumentBytes(
      input({ storagePath }),
      dependencies,
    )).rejects.toMatchObject({ code: 'invalid_storage_path' });
    expect(dependencies.downloadBytes).not.toHaveBeenCalled();
  });

  it('does not write bytes that fail the download integrity check', async () => {
    const dependencies = fixture({
      downloadBytes: jest.fn(async () => new Uint8Array([9])),
    });

    await expect(restoreVerifiedReferenceDocumentBytes(input(), dependencies))
      .rejects.toMatchObject({ code: 'download_integrity_mismatch' });
    expect(dependencies.createOwnedDestination).not.toHaveBeenCalled();
    expect(dependencies.writeBytes).not.toHaveBeenCalled();
  });

  it('deletes a saved copy that fails post-write verification', async () => {
    const dependencies = fixture({
      readBytes: jest.fn(async () => new Uint8Array([9, 9, 9, 9])),
      sha256: jest.fn()
        .mockResolvedValueOnce(SHA)
        .mockResolvedValueOnce('b'.repeat(64)),
    });

    await expect(restoreVerifiedReferenceDocumentBytes(input(), dependencies))
      .rejects.toBeInstanceOf(ReferenceDocumentByteRestoreError);
    expect(dependencies.deleteFile).toHaveBeenCalledWith('file:///owned/document.pdf');
  });
});
