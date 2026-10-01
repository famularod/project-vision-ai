/**
 * Whole-app audit A7 pass 12 M-1 (A4 pass 14 #1, #2a), 30 Sep 2026: an
 * update whose own copy waits in a conflict is left for review by every
 * automatic sync, but its card still read "Waiting to Sync" and "Queued —
 * will sync when you're back online", with David online: nothing said the
 * update needed him, or where. With no photos, the background upload pass
 * finds the conflict on its own. The card now reads "Needs Review" and says
 * where to go; its Retry, still an explicit send, asks first.
 *
 * Renders the App's own UpdateHistoryCard, compiled from App.tsx, with the
 * real SyncService queue, upload and conflict store; the cloud is a mocked
 * row.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, Image, Text, TouchableOpacity, View } from 'react-native';

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

import * as notice from '../../components/field-update-document-change-notice';
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import { fieldUpdateLifecycleLabel } from '../../services/FieldUpdateLifecycle';
import {
  clearResolvedConflict, getSyncConflicts, queueProjectUpdateRecord, resolveProjectUpdateSyncConflict, uploadPendingChanges,
} from '../../services/SyncService';

const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async () => { throw new Error('network disabled in test'); }) as never;
});
afterAll(() => { global.fetch = realFetch; });

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A top-level function of App.tsx, up to the next top-level declaration. */
function appFunction(name: string): string {
  const match = new RegExp(`\\n(?:export )?(?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no function ${name}`);
  const rest = app.slice(match.index + 1);
  const end = rest.slice(1).search(/\n(?:export )?(?:async )?function |\n(?:export )?const |\n(?:export )?type |\ninterface |\n\/\*\*/);
  return rest.slice(0, end < 0 ? undefined : end + 1);
}

type Card = (props: Record<string, unknown>) => React.ReactElement;
/** The App's own update card, with stand-ins for its photo, icon and menu. */
const UpdateHistoryCard = (() => {
  const js = ts.transpileModule(
    [appFunction('queuedStatusCopyForUpdate'), appFunction('UpdateHistoryCard'), 'module.exports = { UpdateHistoryCard };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } },
  ).outputText;
  const deps: Record<string, unknown> = {
    ...notice, React, useState: React.useState, TouchableOpacity, View, Text, Image, fieldUpdateLifecycleLabel,
    useProjectPhotoDisplayUri: () => ({ uri: null, onError: undefined }), resolveProjectPhotoUri: () => null,
    countLabel: (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`,
    Ionicons: () => null, UpdateOverflowMenu: () => null, relativeUpdateTimestamp: () => 'Today',
    styles: new Proxy({}, { get: () => ({}) }), colors: new Proxy({}, { get: () => '#000' }),
    DELETED_TASK_EVIDENCE_LABEL: 'Deleted task evidence', __DEV__: false,
  };
  const mod = { exports: {} as { UpdateHistoryCard: Card } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports.UpdateHistoryCard;
})();

const SENT_AT = '2026-09-28T09:00:00.000Z';
const sent = { id: 'u1', projectName: 'P', date: '2026-09-28', notes: 'Pour', recipients: { contactIds: [] }, photos: [], documents: [], status: 'sent' };
const phoneEdit = { ...sent, notes: 'Pour, 40 yards (typed on the phone with no signal)', status: 'queued', syncDiagnostics: null };
const WAITING_COPY = "Queued — will sync when you're back online";
const REVIEW = 'Needs review — open Settings › Review Conflicts';

/** Saved on the phone offline; the iPad's edit lands after it. */
async function phoneEditThenIPadEdit() {
  await queueProjectUpdateRecord(phoneEdit as never, false);
  await new Promise(resolve => setTimeout(resolve, 5));
  mockCloud.set('u1', { updatedAt: new Date().toISOString(), updateData: { ...sent, notes: 'Pour moved to Tuesday (typed on the iPad)' } });
}
const renderCard = (onRetry = jest.fn()) => {
  render(<UpdateHistoryCard update={phoneEdit} lifecycle="queued" pieStatus={null} onOpen={jest.fn()} onRetry={onRetry} onDelete={jest.fn()} onArchive={jest.fn()} />);
  return onRetry;
};

beforeEach(async () => {
  mockStorage.clear();
  mockCloud.clear();
  await clearResolvedConflict('none'); // the cards' copy of the saved conflicts starts empty too
  noteSignedInOwner('owner-a');
  mockCloud.set('u1', { updatedAt: SENT_AT, updateData: JSON.parse(JSON.stringify(sent)) });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); });

describe('the card of an update left for conflict review says so (audit A7 pass 12 M-1)', () => {
  it('a conflict already saved when the first card shows: read at mount (first: nothing has subscribed yet)', async () => {
    await phoneEditThenIPadEdit();
    await uploadPendingChanges();
    expect(await getSyncConflicts()).toHaveLength(1);
    renderCard();
    expect(await screen.findByText(REVIEW)).toBeTruthy();
    expect(screen.getByText('Needs Review')).toBeTruthy();
  });

  it('no photos, online: the background upload pass finds the conflict, and the card stops saying it is queued to sync', async () => {
    await phoneEditThenIPadEdit();
    renderCard();
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    expect(screen.getByText('Waiting to Sync')).toBeTruthy();
    expect(screen.getByText(WAITING_COPY)).toBeTruthy();

    await act(async () => { await uploadPendingChanges(); }); // reconnected
    expect(await getSyncConflicts()).toHaveLength(1);
    await waitFor(() => expect(screen.getByText(REVIEW)).toBeTruthy());
    expect(screen.getByText('Needs Review')).toBeTruthy();
    expect(screen.queryByText('Waiting to Sync')).toBeNull();
    expect(screen.queryByText(WAITING_COPY)).toBeNull();
  });

  it('its Retry asks before sending the phone\'s version over the other device\'s; Cancel sends nothing', async () => {
    await phoneEditThenIPadEdit();
    await uploadPendingChanges();
    const onRetry = renderCard();
    await screen.findByText(REVIEW);
    fireEvent.press(screen.getByText('Retry'));
    expect(onRetry).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Send your version?',
      'This update was also changed on another device. Send your version over it?',
      [expect.objectContaining({ text: 'Cancel', style: 'cancel' }), expect.objectContaining({ text: 'Send' })],
    );
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find(button => button.text === 'Cancel')?.onPress?.();
    expect(onRetry).not.toHaveBeenCalled();
    buttons.find(button => button.text === 'Send')!.onPress!();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('once the conflict is settled (Keep Phone), the card reads as its status again, and its Retry no longer asks', async () => {
    await phoneEditThenIPadEdit();
    await uploadPendingChanges();
    const onRetry = renderCard();
    await screen.findByText(REVIEW);
    const [conflict] = await getSyncConflicts();
    await act(async () => { await resolveProjectUpdateSyncConflict(conflict.id, 'keep_local'); });
    await waitFor(() => expect(screen.queryByText(REVIEW)).toBeNull());
    expect(screen.getByText('Waiting to Sync')).toBeTruthy(); // this card's props are as they were
    fireEvent.press(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('only the confirmed Send asks the sync to send over the conflict; a Retry with no conflict asks nothing of it (A4 pass 15 H1)', async () => {
    await phoneEditThenIPadEdit();
    await uploadPendingChanges();
    const onRetry = renderCard();
    await screen.findByText(REVIEW);
    fireEvent.press(screen.getByText('Retry'));
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find(button => button.text === 'Send')!.onPress!();
    expect(onRetry).toHaveBeenCalledWith({ overConflict: true });

    const [conflict] = await getSyncConflicts();
    await act(async () => { await clearResolvedConflict(conflict.id); });
    await waitFor(() => expect(screen.queryByText(REVIEW)).toBeNull());
    fireEvent.press(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenLastCalledWith(); // not the press event either
  });

  it('a card with no conflict reads as before', async () => {
    renderCard();
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    expect(screen.getByText('Waiting to Sync')).toBeTruthy();
    expect(screen.getByText(WAITING_COPY)).toBeTruthy();
    expect(screen.queryByText(REVIEW)).toBeNull();
  });
});
