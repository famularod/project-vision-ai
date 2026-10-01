/**
 * Whole-app audit A4 pass 15 M1 (30 Sep 2026): an update in conflict could
 * still be sent over the iPad's edit without a word. The update detail
 * screen's "Retry Sync" (also the iPad's side panel in Updates) and the
 * project page's activity row "Retry" called the retry directly, while the
 * card's Retry asks first (A7 pass 12 M-1), and the detail screen showed only
 * the raw status, never "Needs Review". Both now ask the card's question, and
 * only "Send" sends over the conflict; the detail screen reads "Needs Review"
 * and says where to go.
 *
 * Renders the App's own ReadOnlyUpdateDetailScreen and Phase2ActivityRow,
 * compiled from App.tsx, with the real conflict store behind the card's hook.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';

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

import * as notice from '../../components/field-update-document-change-notice';
import { subscribeToFieldUpdateConflicts } from '../../services/FieldUpdateDocumentChangeNotice';
import { clearResolvedConflict } from '../../services/SyncService';

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
function compile<T>(names: string[], deps: Record<string, unknown>): T {
  const js = ts.transpileModule([...names.map(appFunction), `module.exports = { ${names.join(', ')} };`].join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  const mod = { exports: {} as T };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}
const nothing = () => null;
const shell = {
  ...notice, React, useState: React.useState, Text, View, TouchableOpacity,
  styles: new Proxy({}, { get: () => ({}) }), colors: new Proxy({}, { get: () => '#000' }), Ionicons: nothing,
};
type Screen = (props: Record<string, unknown>) => React.ReactElement;
const { ReadOnlyUpdateDetailScreen } = compile<{ ReadOnlyUpdateDetailScreen: Screen }>(['ReadOnlyUpdateDetailScreen'], {
  ...shell, ScreenTitle: nothing, UpdateOverflowMenu: nothing, UpdateDeleteControl: nothing, PrimaryButton: nothing,
  PIEFindingRow: nothing, ProjectPhotoImage: nothing, ProjectDocumentInlineRow: nothing,
  lifecycleStatusForUpdate: (update: { status: string }) => update.status, updatePIEAnalysisStatus: () => null,
  flowTimingForUpdate: () => ({ elapsedSeconds: null, targetSeconds: 60, canSendWhileAnalysisPending: false }),
  summarizePIEStatusForUpdate: () => ({ status: 'none', summary: 'No photos' }), pieResultsForUpdate: () => [],
  observedFindingsForUpdateBrief: () => [], uniqueStrings: (values: string[]) => values,
  updateSupportsPIEInterpretations: () => false, possibleInterpretationsForPIEResult: () => [],
  formatDisplayDate: (date: string) => date, resolveProjectPhotoUri: () => null,
  pieConfidenceSentence: () => '', pieComparabilitySentence: () => '', pieInterpretationCaveat: () => '',
});
const { Phase2ActivityRow } = compile<{ Phase2ActivityRow: Screen }>(['Phase2ActivityRow'], {
  ...shell, statusStyleForRole: () => ({ icon: 'time-outline', color: '#000' }),
  PIE_STATUS_COPY: { unavailableRetry: 'x', timeoutRetry: 'y', noPriorPhoto: 'z', noReliableChange: 'w', possibleChanges: 'v' },
});

const REVIEW = 'Needs review — open Settings › Review Conflicts';
const update = (id: string) => ({
  id, projectName: 'P', date: '2026-09-28', notes: 'Pour, 40 yards (typed on the phone with no signal)', status: 'queued',
  photos: [], documents: [], recipients: { contactIds: [] },
});
/** A conflict saved on this phone for u1, published as a conflict write is. */
async function conflictSavedFor(id: string) {
  mockStorage.set('projectVisionAI.syncConflicts.v1', JSON.stringify([{
    id: `project_update_conflict-${id}`, entity: 'project_update', localId: id, localChangedAt: '2026-09-28T09:00:00.000Z',
    remoteChangedAt: '2026-09-28T10:00:00.000Z', reason: 'Remote update changed after the local pending change.',
    detectedAt: '2026-09-28T10:05:00.000Z', localPayload: { id, updateData: update(id) },
    remotePayload: { ...update(id), notes: 'Pour moved to Tuesday (typed on the iPad)' },
  }]));
  await clearResolvedConflict('none');
}
const alertButtons = () => (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => void }>;

// The screens' copy of the saved conflicts follows every conflict write from the start, in any test order.
beforeAll(() => { subscribeToFieldUpdateConflicts(() => undefined); });
beforeEach(async () => {
  mockStorage.clear();
  await clearResolvedConflict('none'); // the screens' copy of the saved conflicts starts empty
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); });

describe('the update detail screen of an update in conflict (audit A4 pass 15 M1)', () => {
  it('reads Needs Review and says where to go; its Retry Sync asks, and only Send sends over the conflict', async () => {
    await conflictSavedFor('u1');
    const onRetry = jest.fn();
    render(<ReadOnlyUpdateDetailScreen update={update('u1')} backLabel="Updates" onBack={jest.fn()} onRetry={onRetry} onDelete={jest.fn()} onArchive={jest.fn()} />);
    expect(await screen.findByText('Needs Review')).toBeTruthy();
    expect(screen.getByText(REVIEW)).toBeTruthy();
    expect(screen.queryByText('queued')).toBeNull();

    fireEvent.press(screen.getByText('Retry Sync'));
    expect(onRetry).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Send your version?',
      'This update was also changed on another device. Send your version over it?', expect.any(Array));
    alertButtons().find(button => button.text === 'Cancel')?.onPress?.();
    expect(onRetry).not.toHaveBeenCalled();
    alertButtons().find(button => button.text === 'Send')!.onPress!();
    expect(onRetry).toHaveBeenCalledWith({ overConflict: true });
  });

  it('with no conflict: reads its status, and Retry Sync retries without asking', async () => {
    await conflictSavedFor('u2'); // another update's
    const onRetry = jest.fn();
    render(<ReadOnlyUpdateDetailScreen update={update('u1')} backLabel="Updates" onBack={jest.fn()} onRetry={onRetry} onDelete={jest.fn()} onArchive={jest.fn()} />);
    expect(screen.getByText('queued')).toBeTruthy();
    expect(screen.queryByText(REVIEW)).toBeNull();
    fireEvent.press(screen.getByText('Retry Sync'));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalledWith();
  });
});

describe('the project page\'s activity row of an update in conflict (audit A4 pass 15 M1)', () => {
  const item = { update: update('u1'), projectName: 'P', dateLabel: 'Today', areaLabel: 'Canopy A', photoCount: 0, documentCount: 0, pieStatus: 'No photos' };

  it('its Retry asks, and only Send sends over the conflict', async () => {
    await conflictSavedFor('u1');
    const onRetry = jest.fn();
    render(<Phase2ActivityRow item={item} onPress={jest.fn()} onRetry={onRetry} />);
    fireEvent.press(screen.getByText('Retry'));
    expect(onRetry).not.toHaveBeenCalled();
    alertButtons().find(button => button.text === 'Cancel')?.onPress?.();
    expect(onRetry).not.toHaveBeenCalled();
    alertButtons().find(button => button.text === 'Send')!.onPress!();
    expect(onRetry).toHaveBeenCalledWith({ overConflict: true });
  });

  it('with no conflict, its Retry retries without asking', async () => {
    const onRetry = jest.fn();
    render(<Phase2ActivityRow item={item} onPress={jest.fn()} onRetry={onRetry} />);
    fireEvent.press(screen.getByText('Retry'));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalledWith();
  });
});

describe('every Retry of the detail screen and the activity row passes David\'s choice on to the retry (audit A4 pass 15 M1)', () => {
  it.each([
    ['the update detail screen', 'choice => {\n                        void retryQueuedUpdate(liveDetailUpdate, choice);'],
    ['the side panel of Updates (iPad)', "choice => onRetryQueuedUpdate(selectedUpdate, choice)"],
    ['the project page\'s activity row', 'choice => onRetryQueuedUpdate(item.update, choice)'],
  ])('%s', (_label, wiring) => {
    expect(app.includes(wiring)).toBe(true);
  });
});
