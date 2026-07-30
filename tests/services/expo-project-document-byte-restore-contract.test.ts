import fs from 'fs';
import path from 'path';

describe('project document cloud byte restore adapter', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../services/ExpoProjectDocumentByteRestore.ts'),
    'utf8',
  );

  test('restores only from the protected document bucket into the manifest path', () => {
    expect(source).toContain("const PROJECT_DOCUMENT_BUCKET = 'project-documents'");
    expect(source).toContain('expectedSizeBytes: record.sizeBytes');
    expect(source).toContain('expectedSha256: record.sha256');
    expect(source).toContain('new File(root, record.generatedBasename).uri');
  });

  test('verifies downloaded and written bytes through the shared fail-closed restore', () => {
    expect(source).toContain('restoreVerifiedReferenceDocumentBytes');
    expect(source).toContain('readBytes: uri => new File(uri).bytes()');
    expect(source).toContain('Crypto.CryptoDigestAlgorithm.SHA256');
    expect(source).toContain('if (file.exists) file.delete()');
  });

  test('reference upload preserves locally verified integrity when cloud upload waits', () => {
    const repository = fs.readFileSync(
      path.resolve(__dirname, '../../services/ReferenceDocumentRepository.ts'),
      'utf8',
    );
    expect(repository).toContain(
      "if (!uploaded.ok || uploaded.stubbed) return { ...document, ...integrity };",
    );
  });

  test('reference uploads use the drawing-sized bounded preflight and upload ceiling', () => {
    const repository = fs.readFileSync(
      path.resolve(__dirname, '../../services/ReferenceDocumentRepository.ts'),
      'utf8',
    );
    expect(repository).toContain('preflightExpoFileRead({');
    expect(repository).toContain('maxBytes: MAX_PROJECT_DOCUMENT_FILE_BYTES');
    expect(repository).toContain('reportedSizeBytes: preflight.sizeBytes');
    expect(repository).toContain("'Drawing'");
  });

  test('new project documents are persisted before their upload begins', () => {
    const app = fs.readFileSync(
      path.resolve(__dirname, '../../App.tsx'),
      'utf8',
    );
    const durableAdd = app.indexOf('await addProjectDocumentDurably(document);');
    const upload = app.indexOf(
      'await retryProjectDocumentUpload(document.id, document);',
      durableAdd,
    );

    expect(durableAdd).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(durableAdd);
    expect(app).toContain('await queueReferenceDocumentRecord(sharedDocument);');
    expect(app).toContain('findSharedReferenceDocumentForProjectDocument');
    expect(app).toContain('await ensureVerifiedReferenceDocumentBytes(sharedDocument)');
    expect(app).toContain('Download & Open');
  });
});
