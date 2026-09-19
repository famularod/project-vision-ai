import fs from 'fs';
import path from 'path';

describe('reference-document startup cache contract', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
  const supabaseSource = fs.readFileSync(
    path.resolve(__dirname, '../../services/SupabaseService.ts'),
    'utf8',
  );

  it('does not read the legacy full document index during startup', () => {
    expect(appSource).toContain(
      "const REFERENCE_DOCUMENTS_STORAGE_KEY = 'projectPhotoUpdate.referenceDocumentMetadata.v2';",
    );
    expect(appSource).not.toContain(
      "const REFERENCE_DOCUMENTS_STORAGE_KEY = 'projectPhotoUpdate.referenceDocuments.v1';",
    );
  });

  it('persists and refreshes only operational document metadata', () => {
    expect(appSource).toContain(
      'value: compactECOSReferenceDocumentsForOperationalRead(referenceDocuments)',
    );
    expect(supabaseSource).toContain(
      'const compactDocuments = compactECOSReferenceDocumentsForOperationalRead(documents);',
    );
    expect(supabaseSource).toContain(
      'return okResult(compactDocuments, status);',
    );
  });

  it('uses the bounded metadata RPC for mobile sync instead of reading full document JSON', () => {
    const listStart = supabaseSource.indexOf(
      'export async function listReferenceDocuments()',
    );
    const listEnd = supabaseSource.indexOf(
      'export async function upsertDAVESyncTombstone',
      listStart,
    );
    const listImplementation = supabaseSource.slice(listStart, listEnd);

    expect(listImplementation).toContain(
      "'dave_list_reference_document_metadata'",
    );
    expect(listImplementation).not.toContain(
      'listOwnedJsonRecords<ReferenceDocument>',
    );
  });
});
