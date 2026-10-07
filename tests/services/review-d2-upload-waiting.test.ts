/**
 * Second review of the archive change, P2-L4: how the app answers "is this
 * shared document's own record still waiting on this device to go up to the
 * cloud?" It is asked when the cloud says it holds no such document while an
 * Archive for it waits: only a document made and archived with no signal has
 * no row YET; otherwise "no such row" means it was deleted.
 *
 * The answer comes from the app's own upload list (the sync engine is stood
 * in for here; nothing reaches the network).
 */
jest.mock('../../services/SyncService', () => ({ getOfflineQueue: jest.fn() }));

import { sharedDocumentRecordWaitingToUpload } from '../../services/SharedDocumentUploadWaiting';
import { getOfflineQueue } from '../../services/SyncService';

const uploadList = jest.mocked(getOfflineQueue);
const waiting = (entity: string, id: string) => ({ id: `queue-${entity}-${id}`, entity, operation: 'upsert', payload: { id }, createdAt: '2026-10-06T18:00:00.000Z' });

describe('P2-L4: is this shared document\'s record still waiting to go up?', () => {
  it('yes, when the upload list holds that shared document', async () => {
    uploadList.mockResolvedValue([waiting('project', 'project-1'), waiting('reference_document', 'doc-new')] as never);
    await expect(sharedDocumentRecordWaitingToUpload('doc-new')).resolves.toBe(true);
  });

  it('no, when it holds another shared document, something else with the same id, or nothing', async () => {
    uploadList.mockResolvedValue([waiting('reference_document', 'doc-other'), waiting('project_update', 'doc-new')] as never);
    await expect(sharedDocumentRecordWaitingToUpload('doc-new')).resolves.toBe(false);
    uploadList.mockResolvedValue([{ id: 'queue-odd', entity: 'reference_document', operation: 'upsert', payload: null }] as never);
    await expect(sharedDocumentRecordWaitingToUpload('doc-new')).resolves.toBe(false);
    uploadList.mockResolvedValue([]);
    await expect(sharedDocumentRecordWaitingToUpload('doc-new')).resolves.toBe(false);
  });

  it('when the upload list cannot be read it does not answer "no": it fails, and the archive service then decides nothing', async () => {
    uploadList.mockRejectedValue(new Error('the upload list could not be read'));
    await expect(sharedDocumentRecordWaitingToUpload('doc-new')).rejects.toThrow('could not be read');
  });
});
