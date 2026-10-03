/**
 * Audit round 2, A10 pass 8 M1 / A8 pass 9 M1 scenario A (30 Sep 2026):
 * deleting the old master on the web dropped the field updates of the tasks
 * the new master moved.
 *
 * Alpha's new master was imported before 79f49d3, so the row it saved for
 * Pour slab on its new dates lists no earlier id. A field update is linked to
 * the old Pour slab row. On the web David deletes the old master with "Delete
 * Document + 1 Task". The web wrote only the deletion records: unlike the
 * phone's "Delete PDF + Items" (A10 pass 6 M1), it never wrote the removed id
 * onto the Pour slab shown, so on the web and the phone the update became
 * "Historical evidence — linked task was deleted." and left every summary.
 *
 * Now the web delete first saves the rows shown with the removed ids added,
 * worked out by the phone's own helper (scheduleItemsAfterScheduleDeleted),
 * each only while its cloud revision is the one the web read, and only then
 * writes the deletion records. End to end: the real DesktopAuthProvider,
 * read-only repository and gateway over an in-memory cloud, then the phone's
 * partition over what the cloud holds. Synthetic data.
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
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
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
      // Realtime needs a socket; this test is about what the delete writes.
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

/** Master 0831 has Pour slab; master 0926 moves it by a day and leaves Roofing. */
function moved(legacy: boolean) {
  const before = approve({ items: [], documents: [] }, master, rows(master, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,40%', ROOFING]));
  const oldId = before.items.find(item => item.taskName === 'Pour slab')!.id;
  const after = approve(before, master2, rows(master2, ['Pour slab,Alpha,Lot,09/29/2026,10/01/2026,40%', ROOFING]));
  // A row a new master saved before 79f49d3 kept no earlier ids.
  const items = legacy ? after.items.map(({ revisedFromTaskIds: _earlier, ...item }) => item as ScheduleItem) : after.items;
  const newPour = selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: after.documents })
    .find(item => item.taskName === 'Pour slab')!;
  return { items, documents: after.documents, oldId, newPourId: newPour.id };
}

const fieldUpdate: ProjectUpdate = {
  id: 'u-pour-25sep', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-25T15:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: 'Pour slab: forms set; rebar inspection passed.', scheduleItemId: '', scheduleTaskName: 'Pour slab',
  selectedAreaName: 'Lot',
} as ProjectUpdate;

function seedCloud(state: ReturnType<typeof moved>) {
  cloud.rows('projects').splice(0);
  cloud.rows('schedule_items').splice(0);
  cloud.rows('reference_documents').splice(0);
  cloud.rows('project_updates').splice(0);
  cloud.rows('dave_sync_tombstones').splice(0);
  cloud.insert('projects', { id: 'p-alpha', owner_id: 'owner-1', name: 'Alpha', archived: false, created_at: '2026-08-01T00:00:00.000Z' });
  state.items.forEach((item, index) => cloud.insert('schedule_items', {
    id: item.id, owner_id: 'owner-1', project_name: item.projectName, task_name: item.taskName, item_data: item,
    updated_at: `2026-09-26T09:00:0${index}.000Z`,
  }));
  state.documents.forEach(document => cloud.insert('reference_documents', {
    id: document.id, owner_id: 'owner-1', document_data: document, updated_at: `rev-${document.id}`,
  }));
  const update = { ...fieldUpdate, scheduleItemId: state.oldId };
  cloud.insert('project_updates', {
    id: update.id, owner_id: 'owner-1', project_name: 'Alpha', update_data: update,
    created_at: update.date, updated_at: update.date,
  });
}

function Harness() {
  const auth = useDesktopAuth();
  const [outcome, setOutcome] = useState('none');
  const old = auth.snapshot?.referenceDocuments.find(document => document.id === master.id);
  return (
    <View>
      <Text testID="phase">{auth.phase}</Text>
      <Text testID="outcome">{outcome}</Text>
      <Text testID="old">{old ? `current:${String(old.isCurrent)}|linked:${old.linkedScheduleItems.map(item => item.id).join(',')}` : 'gone'}</Text>
      <Text testID="updates">{auth.snapshot ? auth.snapshot.projectUpdates.map(update => update.id).join(',') : 'none'}</Text>
      <Pressable
        testID="delete-with-task"
        onPress={() => {
          auth.deleteDocument(old!, true).then(
            () => setOutcome('ok'),
            (error: Error) => setOutcome(`error:${error.message}`),
          );
        }}
      >
        <Text>Delete Document + 1 Task</Text>
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

/** What the phone downloads: the saved tasks not deleted, and the deletion records. */
function phoneView() {
  const tombstones = cloud.rows('dave_sync_tombstones').map(row => ({
    entityType: row.entity_type, recordId: row.record_id, deletedAt: row.deleted_at,
  }) as DAVESyncTombstone);
  const deleted = new Set(tombstones.filter(entry => entry.entityType === 'schedule_item').map(entry => entry.recordId));
  const items = cloud.rows('schedule_items').map(row => row.item_data as ScheduleItem).filter(item => !deleted.has(item.id));
  return { tombstones, items };
}

async function renderReady(state: ReturnType<typeof moved>) {
  seedCloud(state);
  const screen = render(<DesktopAuthProvider><Harness /></DesktopAuthProvider>);
  await waitFor(() => expect(text(screen, 'phase')).toBe('ready'));
  // The old master is a prior version the web may delete; "+ 1 Task" is its old Pour slab row.
  expect(text(screen, 'old')).toBe(`current:false|linked:${state.oldId}`);
  expect(text(screen, 'updates')).toBe('u-pour-25sep');
  return screen;
}

describe('A10 p8 M1: "Delete Document + 1 Task" on the old master keeps the field updates of a task the new master moved', () => {
  it('a row saved before 79f49d3 (no earlier ids): the web writes the removed id onto it before the deletion records', async () => {
    const state = moved(true);
    const screen = await renderReady(state);
    fireEvent.press(screen.getByTestId('delete-with-task'));
    await waitFor(() => expect(text(screen, 'outcome')).toBe('ok'));
    await waitFor(() => expect(text(screen, 'old')).toBe('gone'));

    expect(cloud.rows('dave_sync_tombstones').map(row => `${row.entity_type}:${row.record_id}`).sort())
      .toEqual([`reference_document:${master.id}`, `schedule_item:${state.oldId}`]);
    const pour = cloud.rows('schedule_items').find(row => row.id === state.newPourId)!;
    expect((pour.item_data as ScheduleItem).revisedFromTaskIds).toEqual([state.oldId]);
    expect(pour.updated_at).not.toBe('2026-09-26T09:00:00.000Z');

    // The web: the update stays in the workspace (the provider's snapshot, and a fresh read).
    expect(text(screen, 'updates')).toBe('u-pour-25sep');
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(snapshot.projectUpdates.map(update => update.id)).toEqual(['u-pour-25sep']);

    // The phone: the partition keeps it current.
    const phone = phoneView();
    const partition = partitionProjectUpdatesByDeletedTask(
      [{ ...fieldUpdate, scheduleItemId: state.oldId }], phone.tombstones, update => update, { scheduleItems: phone.items },
    );
    expect(partition.historical).toEqual([]);
    expect(partition.active.map(update => update.id)).toEqual(['u-pour-25sep']);
  });

  it('a row saved after 79f49d3 already answers to the old id: nothing else is written', async () => {
    const state = moved(false);
    const screen = await renderReady(state);
    const pourBefore = JSON.stringify(cloud.rows('schedule_items').find(row => row.id === state.newPourId));
    fireEvent.press(screen.getByTestId('delete-with-task'));
    await waitFor(() => expect(text(screen, 'outcome')).toBe('ok'));
    await waitFor(() => expect(text(screen, 'old')).toBe('gone'));
    expect(JSON.stringify(cloud.rows('schedule_items').find(row => row.id === state.newPourId))).toBe(pourBefore);
    expect(text(screen, 'updates')).toBe('u-pour-25sep');
  });

  it('the row changed on another device since the web read it: nothing is deleted, and David is asked to refresh', async () => {
    const state = moved(true);
    const screen = await renderReady(state);
    const changed = { ...(cloud.rows('schedule_items').find(row => row.id === state.newPourId)!.item_data as ScheduleItem), notes: 'Phone note' };
    cloud.change('schedule_items', state.newPourId, { item_data: changed, updated_at: '2026-09-27T10:00:00.000Z' });
    fireEvent.press(screen.getByTestId('delete-with-task'));
    await waitFor(() => expect(text(screen, 'outcome')).toMatch(/^error:The document task links changed on another device/));
    expect(cloud.rows('dave_sync_tombstones')).toEqual([]);
    expect(cloud.rows('schedule_items').find(row => row.id === state.newPourId)!.item_data).toEqual(changed);
  });
});
