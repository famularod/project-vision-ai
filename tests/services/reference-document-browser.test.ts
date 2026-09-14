jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
import { openBrowserAsync } from 'expo-web-browser';
import { openGoogleDriveReferenceDocument } from '../../services/ReferenceDocumentBrowser';
import type { ReferenceDocument } from '../../types';

const document = (fileId: string): ReferenceDocument => ({
  id: 'synthetic-'+fileId, name: fileId, originalFileName: fileId+'.pdf', uri: '',
  category: 'Drawing', notes: '', isCurrent: true, importedAt: '2026-09-14T00:00:00Z',
  sourceProvider: 'google_drive', externalSource: { provider: 'google_drive', fileId,
    name: fileId, mimeType: 'application/pdf', sizeBytes: 1, modifiedTime: null,
    revisionId: null, md5Checksum: null, resourceKey: null,
    webViewLink: 'https://untrusted.invalid/wrong-file' },
});
beforeEach(() => jest.resetAllMocks());
it('opens successive exact file identities in the browser, not an external app handoff', async () => {
  for (const id of ['synthetic_file_B', 'synthetic_file_C', 'synthetic_file_A']) {
    expect(await openGoogleDriveReferenceDocument(document(id))).toBe(true);
    expect(openBrowserAsync).toHaveBeenLastCalledWith('https://drive.google.com/file/d/'+id+'/view',
      { dismissButtonStyle: 'close' });
  }
  expect(openBrowserAsync).toHaveBeenCalledTimes(3);
});
it('never opens invalid provider identities or stored arbitrary URLs', async () => {
  expect(await openGoogleDriveReferenceDocument(document('../other'))).toBe(false);
  expect(openBrowserAsync).not.toHaveBeenCalled();
});
it('propagates browser failure without falling back to a potentially stale app preview', async () => {
  jest.mocked(openBrowserAsync).mockRejectedValue(new Error('browser unavailable'));
  await expect(openGoogleDriveReferenceDocument(document('synthetic_C'))).rejects.toThrow('browser unavailable');
  expect(openBrowserAsync).toHaveBeenCalledTimes(1);
});
