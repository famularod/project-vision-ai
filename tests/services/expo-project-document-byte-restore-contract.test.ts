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
    // SHA-256 through the shared helper, which hands the native digest a
    // TypedArray (field test 28 Sep 2026: an ArrayBuffer fails on the phone).
    expect(source).toContain('sha256: sha256Hex,');
    const hashing = fs.readFileSync(path.resolve(__dirname, '../../services/ExpoSha256.ts'), 'utf8');
    expect(hashing).toContain('Crypto.CryptoDigestAlgorithm.SHA256');
    expect(hashing).toContain('Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, digestInput)');
    expect(hashing).not.toMatch(/digest\([^)]*\.buffer\)/);
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
    // The category list moved to the rule the shared-details record also uses (A7 pass 7 L1).
    expect(repository).toContain('referenceDocumentCategory(value.category)');
    expect(fs.readFileSync(path.resolve(__dirname, '../../services/ReferenceDocumentSharedFields.ts'), 'utf8')).toContain("'Drawing'");
  });

  test('new project documents are persisted before their upload begins', () => {
    const app = fs.readFileSync(
      path.resolve(__dirname, '../../App.tsx'),
      'utf8',
    );
    const documentCard = fs.readFileSync(
      path.resolve(__dirname, '../../components/project-document-card.tsx'),
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
    expect(documentCard).toContain('Download & Open');
  });
});
