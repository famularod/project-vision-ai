/**
 * Audit round 2, A10 pass 8 L3 (30 Sep 2026): the web's Delete Task left the
 * hidden rows of a task a master moved.
 *
 * A new master moved Pour slab: its row answers to the old row's id and hides
 * it. A field update is linked to the old row. Deleting Pour slab on the phone
 * also deletes the hidden rows of its revision chain (A10 pass 7 L5, both ways
 * since A10 pass 8 L1), so the update becomes history. The web's Delete Task
 * recorded only the row shown, so the update stayed current evidence of a task
 * that is gone, on the web and on the phone.
 *
 * Now the web delete records the same rows as the phone
 * (scheduleItemIdsDeletedWithTask). End to end: the real DesktopAuthProvider,
 * repository and gateway over an in-memory cloud. Synthetic data.
 */
import { useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';

import {
  DesktopAuthProvider,
  useDesktopAuth,
} from '../../components/web-shell/desktop-auth-provider';
import * as gatewayModule from '../../services/DAVEWebSupabaseClient';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { FakeWebCloud } from '../fixtures/fake-web-cloud';
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => {
  const actual = jest.requireActual('../../services/DAVEWebSupabaseClient');
  const { createFakeWebCloud } = jest.requireActual('../fixtures/fake-web-cloud');
  const cloud = createFakeWebCloud();
  const gateway = actual.createDAVEWebSupabaseGateway(cloud.client);
  return {
    ...actual,
    __fakeCloud: cloud,
    daveWebSupabaseGateway: {
      ...gateway,
      // Realtime needs a socket; this test is about what the delete records.
      subscribeToAuthorizedOperationalChanges: async () => () => undefined,
    },
  };
});

const cloud = (gatewayModule as unknown as { __fakeCloud: FakeWebCloud }).__fakeCloud;

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true,
  importedAt, projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const master = schedule('MASTER 0831', '2026-08-31T12:00:00.000Z');
const master2 = schedule('MASTER 0926', '2026-09-26T08:00:00.000Z');
const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const documents = [...state.documents, source];
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, documents, source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents };
}
const ROOFING = 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%';
const before = approve({ items: [], documents: [] }, master, rows(master, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,40%', ROOFING]));
const oldId = before.items.find(item => item.taskName === 'Pour slab')!.id;
const moved = approve(before, master2, rows(master2, ['Pour slab,Alpha,Lot,09/29/2026,10/01/2026,40%', ROOFING]));
const newId = moved.items.find(item => item.taskName === 'Pour slab' && item.id !== oldId)!.id;

const update: ProjectUpdate = {
  id: 'u-pour-25sep', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-25T15:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: 'Pour slab: forms set.', scheduleItemId: oldId, scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
} as ProjectUpdate;

function seedCloud(state: State) {
  ['projects', 'schedule_items', 'reference_documents', 'project_updates', 'dave_sync_tombstones'].forEach(table => cloud.rows(table).splice(0));
  cloud.insert('projects', { id: 'p-alpha', owner_id: 'owner-1', name: 'Alpha', archived: false, created_at: '2026-08-01T00:00:00.000Z' });
  state.items.forEach((item, index) => cloud.insert('schedule_items', {
    id: item.id, owner_id: 'owner-1', project_name: item.projectName, task_name: item.taskName, item_data: item,
    updated_at: `2026-09-26T09:00:0${index}.000Z`,
  }));
  state.documents.forEach(document => cloud.insert('reference_documents', {
    id: document.id, owner_id: 'owner-1', document_data: document, updated_at: `rev-${document.id}`,
  }));
  cloud.insert('project_updates', {
    id: update.id, owner_id: 'owner-1', project_name: 'Alpha', update_data: update, created_at: update.date, updated_at: update.date,
  });
}

function Harness() {
  const auth = useDesktopAuth();
  const [outcome, setOutcome] = useState('none');
  const pour = auth.snapshot?.scheduleItems.find(item => item.taskName === 'Pour slab');
  return (
    <View>
      <Text testID="phase">{auth.phase}</Text>
      <Text testID="outcome">{outcome}</Text>
      <Text testID="pour">{pour ? pour.id : 'none'}</Text>
      <Text testID="updates">{auth.snapshot ? auth.snapshot.projectUpdates.map(value => value.id).join(',') : 'none'}</Text>
      <Pressable
        testID="delete-task"
        onPress={() => {
          auth.deleteTask(pour!).then(() => setOutcome('ok'), (error: Error) => setOutcome(`error:${error.message}`));
        }}
      >
        <Text>Delete Task</Text>
      </Pressable>
    </View>
  );
}

const text = (screen: ReturnType<typeof render>, id: string) => String(screen.getByTestId(id).props.children);
const originalBroadcastChannel = globalThis.BroadcastChannel;
beforeAll(() => {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
});
afterAll(() => {
  globalThis.BroadcastChannel = originalBroadcastChannel;
});

function phonePartition() {
  const tombstones = cloud.rows('dave_sync_tombstones').map(row => ({
    entityType: row.entity_type, recordId: row.record_id, deletedAt: row.deleted_at,
  }) as DAVESyncTombstone);
  const deleted = new Set(tombstones.map(entry => entry.recordId));
  const items = cloud.rows('schedule_items').map(row => row.item_data as ScheduleItem).filter(item => !deleted.has(item.id));
  return partitionProjectUpdatesByDeletedTask([update], tombstones, value => value, { scheduleItems: items });
}

async function deleteShownPour(state: State, shownId: string) {
  seedCloud(state);
  const screen = render(<DesktopAuthProvider><Harness /></DesktopAuthProvider>);
  await waitFor(() => expect(text(screen, 'phase')).toBe('ready'));
  expect(text(screen, 'pour')).toBe(shownId);
  expect(text(screen, 'updates')).toBe('u-pour-25sep');
  fireEvent.press(screen.getByTestId('delete-task'));
  await waitFor(() => expect(text(screen, 'outcome')).toBe('ok'));
  await waitFor(() => expect(text(screen, 'pour')).toBe('none'));
  return screen;
}

describe('A10 p8 L3: the web\'s Delete Task records the hidden rows of the task\'s revision chain, as the phone does', () => {
  it('deleting the moved Pour slab records the hidden old row too; its update is history on the web and the phone', async () => {
    const screen = await deleteShownPour(moved, newId);
    expect(cloud.rows('dave_sync_tombstones').map(row => row.record_id).sort()).toEqual([newId, oldId].sort());
    await waitFor(() => expect(text(screen, 'updates')).toBe(''));
    expect(phonePartition().historical.map(value => value.id)).toEqual(['u-pour-25sep']);
  });

  it('after Make Current back to the old master, deleting the old Pour slab records the newer hidden row too', async () => {
    const oldDoc = moved.documents.find(document => document.id === master.id)!;
    const backOnOld = { ...moved, documents: scheduleDocumentsAfterActivation(oldDoc, moved.documents, 'project') };
    await deleteShownPour(backOnOld, oldId);
    expect(cloud.rows('dave_sync_tombstones').map(row => row.record_id).sort()).toEqual([newId, oldId].sort());
  });
});
