/**
 * Audit round 2, A10 pass 5 M1 (30 Sep 2026): when a new master moved a
 * task's dates, the summaries lost that task's field updates.
 *
 * A field update linked to Pour slab is saved on 25 Sep. On 26 Sep a new
 * master moves Pour slab by a day: the import saves it as a new row with a
 * new id and hides the old row (owner answer Q22, ScheduleImportMerge). The
 * update still names the old id, so reconciliation, evidence correlation,
 * Project Truth and the action inbox matched it to no task: Project Truth said
 * "No connected field, photo, or communication evidence is available" and the
 * action inbox said "Scheduled work lacks recent field evidence … no
 * task-specific field update confirms current status". Before the revision
 * the same update matched.
 *
 * Now the new row keeps the ids it had before (revisedFromTaskIds, carried
 * forward so A→B→C keeps A and B), and every summary resolves an update's
 * task through one helper (ScheduleTaskRevisions). A row saved before this
 * fix carries no ids: an update whose task id is not a current task then
 * matches by its stored task name within its project and area, only when
 * exactly one current task has that name. Synthetic data only.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEActionInbox } from '../../services/DAVEActionInbox';
import { buildDAVEEvidenceCorrelations } from '../../services/DAVEEvidenceCorrelation';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildPIEScheduleReconciliation, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleImportAddsToMaster } from '../../services/ScheduleLookahead';
import { scheduleItemAnsweringToTaskId } from '../../services/ScheduleTaskRevisions';
import { buildVitruviusCommitmentControl } from '../../services/VitruviusCommitmentControl';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

const NOW = '2026-09-26T12:00:00.000Z';
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true,
  importedAt, projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
  cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt,
}) as ReferenceDocument;
const master = schedule('MASTER 0831', '2026-08-31T12:00:00.000Z');
const master2 = schedule('MASTER 0926', '2026-09-26T08:00:00.000Z');
const master3 = schedule('MASTER 0927', '2026-09-27T08:00:00.000Z');

const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
function rows(source: ReferenceDocument, pourStart: string, pourFinish: string): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, `Pour slab,Alpha,Lot,${pourStart},${pourFinish},40%`, 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%'].join('\n'),
    sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha', 'Beta'], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const documents = [...state.documents, source];
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items,
    imported,
    completionMatch: () => null,
    mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, documents, source.importBatchId || ''),
    overlay: scheduleImportAddsToMaster({ id: source.importBatchId || '', documents: [source] }, state.documents),
    approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents };
}
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pourOf = (items: readonly ScheduleItem[]) => {
  const pours = items.filter(item => item.taskName === 'Pour slab');
  expect(pours).toHaveLength(1);
  return pours[0];
};

function fieldUpdate(id: string, scheduleItemId: string, date: string, extra: Partial<ProjectUpdate> = {}): ProjectUpdate {
  return {
    id, projectName: 'Alpha', scheduleProjectName: 'Alpha', date, photos: [], recipients: { contactIds: [] },
    notes: 'Pour slab forms set; rebar inspection passed.', scheduleItemId, scheduleTaskName: 'Pour slab',
    selectedAreaName: 'Lot', ...extra,
  } as ProjectUpdate;
}

/** What each summary says of Pour slab, given the tasks shown and the field updates. */
function summaries(items: ScheduleItem[], updates: ProjectUpdate[], documents: ReferenceDocument[]) {
  const pour = pourOf(items);
  const reconciliation = buildPIEScheduleReconciliation({ scheduleItems: items, updates, projectName: 'Alpha', now: new Date(NOW) });
  const correlation = buildDAVEEvidenceCorrelations({ scheduleItems: items, updates, now: NOW }).tasks.find(task => task.taskId === pour.id)!;
  const truth = buildDAVEProjectTruth({
    projectId: 'project-alpha', projectName: 'Alpha', updates, scheduleItems: items, referenceDocuments: documents, now: NOW,
  });
  const inbox = buildDAVEActionInbox({ scheduleItems: items, updates, reconciliationWarnings: reconciliation.warnings, now: new Date(NOW) });
  return {
    pour,
    matchedUpdates: reconciliation.matches.filter(match => match.scheduleItemId === pour.id).map(match => match.updateId),
    lacksEvidence: reconciliation.warnings.some(warning =>
      warning.scheduleItemId === pour.id && warning.type === 'scheduled_work_without_recent_evidence'),
    correlated: correlation.evidence.filter(claim => claim.kind === 'field_update').map(claim => claim.sourceRecordId),
    explanation: correlation.explanation,
    truthExplanation: truth.correlations.tasks.find(task => task.taskId === pour.id)!.explanation,
    truthLinks: truth.entityLinks
      .filter(link => link.targetType === 'schedule-task' && link.targetId === pour.id && link.sourceEvidenceId.startsWith('update:'))
      .map(link => link.sourceEvidenceId),
    inbox: inbox.items.filter(item => item.scheduleItemId === pour.id).map(item => `${item.title}: ${item.summary}`).join(' | '),
  };
}

const NO_EVIDENCE = 'No connected field, photo, or communication evidence is available.';
const LACKS = 'Scheduled work lacks recent field evidence';

describe('A10 pass 5 M1: a task a new master moved keeps its field updates', () => {
  const before: State = { items: rows(master, '09/28/2026', '09/30/2026'), documents: [master] };
  const atMaster = pourOf(shown(before));
  const update25 = fieldUpdate('u-pour-25sep', atMaster.id, '2026-09-25T15:00:00.000Z');
  // 26 Sep: the new master moves Pour slab by a day; Roofing is unchanged.
  const after = approve(before, master2, rows(master2, '09/29/2026', '10/01/2026'));

  it('before the revision, every summary matches the 25 Sep update to Pour slab', () => {
    const said = summaries(shown(before), [update25], before.documents);
    expect(said.matchedUpdates).toEqual(['u-pour-25sep']);
    expect(said.lacksEvidence).toBe(false);
    expect(said.correlated).toEqual(['u-pour-25sep']);
    expect(said.truthExplanation).not.toContain(NO_EVIDENCE);
    expect(said.truthLinks).toEqual(['update:u-pour-25sep']);
    expect(said.inbox).not.toContain(LACKS);
  });

  it('the revision saves Pour slab as a new row, hides the old one, and the new row answers to the old id', () => {
    const pour = pourOf(shown(after));
    expect(pour.id).not.toBe(atMaster.id);
    expect(pour.startDate).toBe('09/29/2026');
    expect(after.items.some(item => item.id === atMaster.id)).toBe(true);
    expect(pour.revisedFromTaskIds).toEqual([atMaster.id]);
    // Roofing was unchanged: it keeps its own id and says nothing about earlier ids.
    expect(shown(after).find(item => item.taskName === 'Roofing')).not.toHaveProperty('revisedFromTaskIds');
    expect(scheduleItemAnsweringToTaskId(shown(after), atMaster.id)?.id).toBe(pour.id);
  });

  it('after the revision, reconciliation, correlation, Project Truth and the action inbox still match the 25 Sep update', () => {
    const said = summaries(shown(after), [update25], after.documents);
    expect(said.matchedUpdates).toEqual(['u-pour-25sep']);
    expect(said.lacksEvidence).toBe(false);
    expect(said.correlated).toEqual(['u-pour-25sep']);
    expect(said.explanation).not.toContain(NO_EVIDENCE);
    expect(said.truthExplanation).not.toContain(NO_EVIDENCE);
    expect(said.truthLinks).toEqual(['update:u-pour-25sep']);
    expect(said.inbox).not.toContain(LACKS);
    expect(said.inbox).not.toContain('no task-specific field update confirms current status');
  });

  it('an open field action on the update points the action inbox and the commitment register at the task shown now', () => {
    const withAction = fieldUpdate('u-pour-action', atMaster.id, '2026-09-25T16:00:00.000Z', {
      photos: [{
        id: 'p-1', uri: 'file:///p-1.jpg', caption: 'Edge form', category: 'Open Issue', actionRequired: 'Re-set the east edge form',
        actionOwner: 'Acme Concrete', actionDueDate: '', actionStatus: 'Open', selectedAreaName: 'Lot',
      }] as ProjectUpdate['photos'],
    });
    const items = shown(after);
    const pour = pourOf(items);
    const inbox = buildDAVEActionInbox({ scheduleItems: items, updates: [withAction], now: new Date(NOW) });
    expect(inbox.items.find(item => item.kind === 'field_action')?.scheduleItemId).toBe(pour.id);
    const control = buildVitruviusCommitmentControl({ projectNames: ['Alpha'], scheduleItems: items, updates: [withAction], now: new Date(NOW) });
    expect(control.items.find(item => item.id === pour.id)?.latestFieldUpdateAt).toBe('2026-09-25T16:00:00.000Z');
  });

  it('a two-step chain A→B→C keeps both A and B: updates on either match the task shown now', () => {
    const pourB = pourOf(shown(after));
    const update26 = fieldUpdate('u-pour-26sep', pourB.id, '2026-09-26T09:00:00.000Z', { notes: 'Pour slab: pump truck booked.' });
    const third = approve(after, master3, rows(master3, '09/30/2026', '10/02/2026'));
    const pourC = pourOf(shown(third));
    expect(new Set([atMaster.id, pourB.id, pourC.id]).size).toBe(3);
    expect(pourC.revisedFromTaskIds).toEqual([atMaster.id, pourB.id]);
    const said = summaries(shown(third), [update25, update26], third.documents);
    expect(said.matchedUpdates).toEqual(['u-pour-26sep']); // the latest of the two is the task's best match
    expect(said.lacksEvidence).toBe(false);
    expect(said.correlated.sort()).toEqual(['u-pour-25sep', 'u-pour-26sep']);
    expect(said.truthLinks.sort()).toEqual(['update:u-pour-25sep', 'update:u-pour-26sep']);
    expect(said.inbox).not.toContain(LACKS);
  });
});

describe('A10 pass 5 M1: rows saved before this fix match by the update\'s stored task name, one task only', () => {
  const before: State = { items: rows(master, '09/28/2026', '09/30/2026'), documents: [master] };
  const oldId = pourOf(shown(before)).id;
  const after = approve(before, master2, rows(master2, '09/29/2026', '10/01/2026'));
  // A row a new master saved before this fix: no earlier ids.
  const legacy = shown(after).map(({ revisedFromTaskIds: _earlier, ...item }) => item as ScheduleItem);
  const update25 = fieldUpdate('u-pour-25sep', oldId, '2026-09-25T15:00:00.000Z');

  it('the one current Pour slab in Alpha, Lot takes the update', () => {
    expect(pourOf(legacy)).not.toHaveProperty('revisedFromTaskIds');
    const said = summaries(legacy, [update25], after.documents);
    expect(said.matchedUpdates).toEqual(['u-pour-25sep']);
    expect(said.lacksEvidence).toBe(false);
    expect(said.correlated).toEqual(['u-pour-25sep']);
    expect(said.truthLinks).toEqual(['update:u-pour-25sep']);
    expect(said.inbox).not.toContain(LACKS);
  });

  it('a second Pour slab in another area of Alpha does not stop the update whose area is Lot', () => {
    const deck = { ...pourOf(legacy), id: 'deck-pour', locationName: 'Deck' };
    expect(scheduleItemAnsweringToTaskId([...legacy, deck], oldId, update25)?.id).toBe(pourOf(legacy).id);
  });

  it('never guesses between duplicates: two current Pour slabs the update could be leave it matched to neither', () => {
    const deck = { ...pourOf(legacy), id: 'deck-pour', locationName: 'Deck' };
    const noArea = fieldUpdate('u-pour-no-area', oldId, '2026-09-25T15:00:00.000Z', { selectedAreaName: null });
    const items = [...legacy, deck];
    expect(scheduleItemAnsweringToTaskId(items, oldId, noArea)).toBeNull();
    const reconciliation = buildPIEScheduleReconciliation({ scheduleItems: items, updates: [noArea], projectName: 'Alpha', now: new Date(NOW) });
    expect(reconciliation.matches).toEqual([]);
    const correlations = buildDAVEEvidenceCorrelations({ scheduleItems: items, updates: [noArea], now: NOW });
    expect(correlations.tasks.flatMap(task => task.evidence).filter(claim => claim.kind === 'field_update')).toEqual([]);
    // Two in the same area: neither.
    const twin = { ...pourOf(legacy), id: 'twin-pour' };
    expect(scheduleItemAnsweringToTaskId([...legacy, twin], oldId, update25)).toBeNull();
  });

  it('a same-named task of another project is never the update\'s', () => {
    const beta = legacy.map(item => ({ ...item, id: `beta-${item.id}`, projectName: 'Beta', scheduleProjectName: 'Beta' }));
    expect(scheduleItemAnsweringToTaskId(beta, oldId, update25)).toBeNull();
  });

  it('an update with no stored task name, or whose task id is current, is not matched by name', () => {
    expect(scheduleItemAnsweringToTaskId(legacy, oldId, { ...update25, scheduleTaskName: null })).toBeNull();
    const roofing = legacy.find(item => item.taskName === 'Roofing')!;
    expect(scheduleItemAnsweringToTaskId(legacy, roofing.id, update25)?.id).toBe(roofing.id);
  });
});
