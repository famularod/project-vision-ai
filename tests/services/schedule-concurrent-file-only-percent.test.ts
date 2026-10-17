/** A file's numeric progress survives a concurrent first lookahead that explicitly leaves progress alone. */
import type { ScheduleItem } from '../../types';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import { scheduleLookaheadApprovalsOfBoth } from '../../services/ScheduleLookahead';

const MASTER_AT = '2026-09-07T12:00:00.000Z';
const OLDER_AT = '2026-09-09T12:00:00.000Z';
const NEWER_AT = '2026-09-09T14:00:00.000Z';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const master = (percentComplete = 0): ScheduleItem => ({
  id: 'master-framing', projectName: 'Alpha', locationName: 'Lot', taskName: 'Framing', owner: '', contractor: '',
  startDate: '10/15/2026', finishDate: '10/25/2026', milestone: '', notes: '', priority: 'Medium',
  percentComplete, status: percentComplete === 100 ? 'Complete' : percentComplete ? 'In Progress' : 'Not Started',
  createdAt: MASTER_AT, importedAt: MASTER_AT, importBatchId: 'master-batch', sourceDocumentId: 'master-document',
});
function approve(before: ScheduleItem, batch: string, percent: number | null, at: string, startDate: string, finishDate: string) {
  const row: ScheduleItem = {
    ...master(percent ?? 0), id: `${batch}-framing`, importBatchId: batch, sourceDocumentId: `${batch}-document`,
    importedAt: at, createdAt: at, startDate, finishDate, ...(percent === null ? { percentCompleteStated: false } : {}),
  };
  return mergeApprovedScheduleImportItems({
    existing: [before], imported: [row], completionMatch: () => null, mergeCompletion: item => item,
    overlay: true, approvedAt: at,
  }).next[0];
}
function pair(before = master(), statedPercent = 70) {
  const stated = approve(before, 'stated', statedPercent, OLDER_AT, '10/18/2026', '10/28/2026');
  const blank = approve(before, 'blank', null, NEWER_AT, '10/21/2026', '10/31/2026');
  const merged = { ...blank, alsoImportedInBatchIds: ['blank', 'stated'] };
  return { before, stated, blank, merged };
}
type Pair = ReturnType<typeof pair>;
function combine(p: Pair, swap = false) {
  return scheduleLookaheadApprovalsOfBoth(p.merged, swap ? p.stated : p.blank,
    p.before as unknown as Record<string, unknown>, swap ? p.blank : p.stated) ?? p.merged;
}
const withoutNote = ({ lookaheadOverlay: _note, ...item }: ScheduleItem) => item;

it.each([false, true])('keeps the sole file percent with the merged dates, note and progress provenance (swapped=%s)', swap => {
  const p = pair();
  const inputs = clone(p);
  const result = combine(p, swap);
  expect(result).toEqual({ ...p.merged, percentComplete: 70, status: 'In Progress', lookaheadOverlay: {
    ...p.blank.lookaheadOverlay!, lookaheads: [p.stated.lookaheadOverlay!.lookaheads[0], p.blank.lookaheadOverlay!.lookaheads[0]],
  } });
  expect(p).toEqual(inputs);
});

it.each([[40, 0], [40, 20], [0, 100]])('preserves an explicit numeric statement from %s to %s, including zero and completion', (start, stated) => {
  const p = pair(master(start), stated);
  expect(combine(p)).toMatchObject({ percentComplete: stated, status: p.stated.status });
});

it('keeps existing owner, notes and priority from the common base', () => {
  const p = pair({ ...master(), owner: 'Mike', notes: 'Pour Tuesday', priority: 'High' });
  expect(combine(p)).toMatchObject({ percentComplete: 70, owner: 'Mike', notes: 'Pour Tuesday', priority: 'High' });
});

it.each([
  ['the file with a percent has a later device clock', '2026-09-10T18:00:00.000Z', OLDER_AT],
  ['the device clocks tie', NEWER_AT, NEWER_AT],
])('%s: a blank still makes no progress statement', (_label, statedAt, blankAt) => {
  const p = pair();
  p.stated.lookaheadOverlay!.lookaheads[0].importedAt = statedAt;
  p.blank.lookaheadOverlay!.lookaheads[0].importedAt = blankAt;
  p.stated.updatedAt = '2030-01-01T00:00:00.000Z';
  p.blank.updatedAt = '2020-01-01T00:00:00.000Z';
  expect(combine(p)).toMatchObject({ percentComplete: 70, startDate: p.merged.startDate, finishDate: p.merged.finishDate });
});

it('replaying an already merged pair changes nothing', () => {
  const p = pair();
  const once = combine(p);
  const twice = scheduleLookaheadApprovalsOfBoth(once, p.blank, p.before as unknown as Record<string, unknown>, once) ?? once;
  expect(twice).toEqual(once);
});

it('a newer explicit zero is a statement, even when the base was zero', () => {
  const p = pair();
  p.blank = approve(p.before, 'blank', 0, NEWER_AT, '10/21/2026', '10/31/2026');
  p.merged = { ...p.blank, alsoImportedInBatchIds: ['blank', 'stated'] };
  expect(combine(p)).toMatchObject({ percentComplete: 0, status: 'Not Started' });
  expect(combine(p).lookaheadOverlay!.lookaheads[1].percentComplete).toBe(0);
});

const negatives: Array<[string, (p: Pair) => void]> = [
  ['unknown blank entry', p => { delete p.blank.lookaheadOverlay!.lookaheads[0].percentComplete; }],
  ['unknown numeric entry', p => { delete p.stated.lookaheadOverlay!.lookaheads[0].percentComplete; }],
  ['a stated percent withheld by a manager floor', p => { p.blank.lookaheadOverlay!.lookaheads[0].percentStated = true; }],
  ['unparsed numeric provenance', p => { (p.stated.lookaheadOverlay!.lookaheads[0] as { percentComplete: unknown }).percentComplete = '70'; }],
  ['invalid numeric provenance', p => { p.stated.lookaheadOverlay!.lookaheads[0].percentComplete = Number.NaN; }],
  ['unknown file provenance', p => { delete p.before.sourceDocumentId; delete p.blank.sourceDocumentId; delete p.stated.sourceDocumentId; delete p.merged.sourceDocumentId; }],
  ['unknown base percent', p => { delete (p.before as Partial<ScheduleItem>).percentComplete; }],
  ['a different row', p => { p.stated.id = 'another-row'; }],
  ['a different master', p => { p.stated.importBatchId = 'another-master'; }],
  ['a different project', p => { p.stated.projectName = 'Beta'; }],
  ['unknown progress source', p => { (p.stated as { progressSource: unknown }).progressSource = 'unknown'; }],
  ['a partial base without identity', p => { delete (p.before as Partial<ScheduleItem>).id; }],
  ['a merged note carrying another progress provenance', p => { p.merged.lookaheadOverlay = { ...p.merged.lookaheadOverlay!, masterProgressSource: 'project_manager', masterProgressConfirmedBy: 'David' }; }],
  ['a master restatement', p => { p.stated.fileProgressLast = { percentComplete: 70, statedAt: OLDER_AT }; }],
  ['a date moved by hand', p => { p.stated.startDate = '10/19/2026'; }],
  ['a deleted file with dates kept', p => { p.stated.lookaheadOverlay!.lookaheads[0].datesKeptAt = NEWER_AT; }],
  ['a replaced file', p => { p.stated.lookaheadOverlay!.lookaheads[0].datesReplacedByMaster = 'master-newer'; }],
  ['owner entered meanwhile', p => { p.blank.owner = 'Mike'; p.merged.owner = 'Mike'; }],
  ['note entered meanwhile', p => { p.stated.notes = 'Keep this note'; }],
  ['priority entered meanwhile', p => { p.stated.priority = 'High'; }],
  ['manual progress on the blank copy', p => { p.blank.progressSource = 'project_manager'; p.blank.progressConfirmedBy = 'David'; p.merged = { ...p.merged, progressSource: 'project_manager', progressConfirmedBy: 'David' }; }],
  ['manual progress on the numeric copy', p => { p.stated.progressSource = 'project_manager'; p.stated.progressConfirmedBy = 'David'; }],
  ['a floor under file progress', p => { p.stated.managersPercentUnderFile = 30; }],
  ['a carried percent', p => { p.stated.progressCarriedFrom = { taskId: 'previous-row', judgedAt: MASTER_AT }; }],
  ['another approval on the numeric copy', p => { p.stated.lookaheadOverlay!.lookaheads.unshift({ ...p.stated.lookaheadOverlay!.lookaheads[0], batchId: 'third' }); }],
];
it.each(negatives)('%s keeps the original merged progress and all other fields', (_label, change) => {
  const p = pair();
  change(p);
  const before = withoutNote(p.merged);
  expect(withoutNote(combine(p))).toEqual(before);
});

it.each([null, undefined])('a missing base (%s) changes nothing', before => {
  const p = pair();
  expect(scheduleLookaheadApprovalsOfBoth(p.merged, p.blank, before, p.stated)).toBeNull();
});

it('manual progress already in the common base stays outside this repair', () => {
  const p = pair({ ...master(30), progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: MASTER_AT });
  expect(withoutNote(combine(p))).toEqual(withoutNote(p.merged));
});

it('a prior lookahead deleted on one side is not mistaken for two first approvals', () => {
  const first = approve(master(), 'first', 70, MASTER_AT, '10/17/2026', '10/27/2026');
  const p = pair(first, 80);
  p.stated.lookaheadOverlay!.lookaheads = p.stated.lookaheadOverlay!.lookaheads.filter(entry => entry.batchId !== 'first');
  expect(withoutNote(combine(p))).toEqual(withoutNote(p.merged));
});

it('compares stored note fields independently of JSON key order', () => {
  const p = pair();
  const reversed = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).reverse()) as T;
  p.blank.lookaheadOverlay = reversed(p.blank.lookaheadOverlay!);
  p.stated.lookaheadOverlay = reversed(p.stated.lookaheadOverlay!);
  p.merged.lookaheadOverlay = reversed(p.merged.lookaheadOverlay!);
  expect(combine(p)).toMatchObject({ percentComplete: 70, status: 'In Progress',
    startDate: p.merged.startDate, finishDate: p.merged.finishDate });
});
