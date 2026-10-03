/**
 * Whole-app audit A7 pass 8 L2 (30 Sep 2026): a document change on a sent
 * field update leaves it "Sent" and only its patch goes up. When that upload
 * failed, the update still read "Sent" and the iPad still listed the
 * document; nothing on the update's card said so, only Admin.
 *
 * Renders the card's line with the real SyncService queue and upload; the
 * cloud is a mocked row. Checks that the App's update card renders it.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStorage.get(key) ?? null])),
    multiSet: jest.fn(async (pairs: Array<[string, string]>) => { pairs.forEach(([key, value]) => mockStorage.set(key, value)); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
  };
  return { __esModule: true, default: api, ...api };
});
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: 'file:///phone/Documents/',
  cacheDirectory: 'file:///phone/Library/Caches/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));

const mockCloud = new Map<string, { updatedAt: string; updateData: Record<string, any> }>();
jest.mock('../../services/SupabaseService', () => {
  const ok = <T,>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
  const project = { id: '72e941d8-8114-4082-a976-ae5b2b5daba9', name: 'P' };
  return {
    ...jest.requireActual('../../services/SupabaseService'),
    getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
    verifyDAVEAppOwner: jest.fn(async () => ({ ok: true, data: true })),
    listProjects: jest.fn(async () => ok([project])),
    listArchivedProjects: jest.fn(async () => ok([])),
    listDAVESyncTombstones: jest.fn(async () => ok([])),
    getProjectUpdateSyncMetadata: jest.fn(async (id: string) => {
      const current = mockCloud.get(id);
      return ok(current ? { id, projectId: project.id, updatedAt: current.updatedAt, projectName: 'P', areaName: '',
        updateData: JSON.parse(JSON.stringify(current.updateData)) } : null);
    }),
    saveProjectUpdate: jest.fn(async (params: { id: string; updatedAt: string; updateData: Record<string, unknown> }) => {
      mockCloud.set(params.id, { updatedAt: params.updatedAt, updateData: JSON.parse(JSON.stringify(params.updateData)) });
      return ok({ id: params.id, updateData: params.updateData });
    }),
  };
});
jest.mock('../../services/DAVECloudMaintenanceBudget', () => ({
  ...jest.requireActual('../../services/DAVECloudMaintenanceBudget'),
  runDAVECloudMaintenanceIfDue: jest.fn(async () => ({ storageCleanupRemaining: 0, storageCleanupCompleted: 0, storageCleanupErrors: [] })),
}));

import { FieldUpdateDocumentChangeNotice } from '../../components/field-update-document-change-notice';
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import { withoutFieldUpdateDocument } from '../../services/FieldUpdateDocumentUploadState';
import { saveProjectUpdate } from '../../services/SupabaseService';
import { queueProjectUpdateDocumentChange, uploadPendingChanges } from '../../services/SyncService';

const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async () => { throw new Error('network disabled in test'); }) as never;
});
afterAll(() => { global.fetch = realFetch; });

const LINE = 'Document change waiting to sync';
const document = (id: string) => ({ id, name: `${id}.pdf`, category: 'Permit', status: 'uploaded', updateId: 'u1' });
const sent = {
  id: 'u1', projectName: 'P', date: '2026-09-28', notes: 'Pour', recipients: { contactIds: [] }, photos: [],
  documents: [document('permit'), document('survey')], status: 'sent',
};

beforeEach(() => {
  mockStorage.clear();
  mockCloud.clear();
  noteSignedInOwner('owner-a');
  mockCloud.set('u1', { updatedAt: '2026-09-28T09:00:00.000Z', updateData: JSON.parse(JSON.stringify(sent)) });
});

describe('the update card says when a document change on a sent update waits to sync (audit A7 pass 8 L2)', () => {
  it('a patch already failing when the first card shows: shown from the queue read at mount (first: nothing has subscribed yet)', async () => {
    await queueProjectUpdateDocumentChange(withoutFieldUpdateDocument(sent, 'permit'), 'permit');
    (saveProjectUpdate as jest.Mock).mockResolvedValueOnce({ ok: false, configured: true, stubbed: false, error: 'permission denied' });
    await uploadPendingChanges();

    render(<View><FieldUpdateDocumentChangeNotice updateId="u1" /><FieldUpdateDocumentChangeNotice updateId="u2" /></View>);
    expect(await screen.findByText(LINE)).toBeTruthy();
    expect(screen.getAllByText(LINE)).toHaveLength(1); // only that update's card
  });

  it('shown after the patch upload is refused, and gone once it uploads', async () => {
    await queueProjectUpdateDocumentChange(withoutFieldUpdateDocument(sent, 'permit'), 'permit');
    render(<FieldUpdateDocumentChangeNotice updateId="u1" />);
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    expect(screen.queryByText(LINE)).toBeNull(); // just queued: it normally goes up in seconds

    (saveProjectUpdate as jest.Mock).mockResolvedValueOnce({ ok: false, configured: true, stubbed: false, error: 'permission denied' });
    await act(async () => { await uploadPendingChanges(); });
    expect(await screen.findByText(LINE)).toBeTruthy();
    expect(mockCloud.get('u1')!.updateData.documents.map((item: { id: string }) => item.id)).toEqual(['permit', 'survey']);

    await act(async () => { await uploadPendingChanges(); });
    await waitFor(() => expect(screen.queryByText(LINE)).toBeNull());
    expect(mockCloud.get('u1')!.updateData.documents.map((item: { id: string }) => item.id)).toEqual(['survey']);
  });

  it('a patch still waiting after two minutes shows without a failure', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    try {
      await queueProjectUpdateDocumentChange(withoutFieldUpdateDocument(sent, 'permit'), 'permit');
      render(<FieldUpdateDocumentChangeNotice updateId="u1" />);
      await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
      expect(screen.queryByText(LINE)).toBeNull();
      await act(async () => { jest.advanceTimersByTime(2 * 60_000); });
      expect(screen.getByText(LINE)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('the App\'s update card renders the line', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    const card = app.slice(app.indexOf('function UpdateHistoryCard'), app.indexOf('function UpdateOverflowMenu'));
    // Pin changed in A7 pass 12 M-1: the same line also says where to settle a
    // conflict the update waits in (audit-a7-p12-conflict-review-card.test.tsx).
    expect(card).toContain('<FieldUpdateDocumentChangeNotice updateId={update.id} conflictReview={conflictReview} />');
  });
});
