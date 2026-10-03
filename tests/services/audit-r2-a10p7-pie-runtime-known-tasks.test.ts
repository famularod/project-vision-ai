/**
 * Audit round 2, A10 pass 7 L2 (30 Sep 2026): the A10 pass 6 L2 guard did
 * not reach the PIE runtime.
 *
 * ad78f05 made the name fallback check the update's own old schedule, given
 * every saved task (knownScheduleItems), and the phone and the web passed them
 * to the summaries. The runtime's evidence fusion ran its own reconciliation
 * without them, so after a new master dropped phase 1 of two "Pour slab"
 * tasks, phase 1's "complete" report still fell back by name to phase 2 there:
 * the phone's Project Truth briefing listed "Recent field evidence may show
 * Pour slab complete while the schedule remains Not Started at 0%" under
 * risks, and a generated report added "Schedule attention: …". The web has no
 * runtime, so the phone and the web disagreed.
 *
 * Now the runtime context carries every saved task (the live authority's
 * input already had them), the evidence fusion passes them to its
 * reconciliation, and the live authority's runtime cache key includes them.
 * Synthetic data.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildFusedEvidence } from '../../services/PIEEvidenceFusion';
import { authorityInputSignature } from '../../services/PIELiveAuthoritySignature';
import { buildRuntime } from '../../services/PIERuntime';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import type { PIELiveAuthorityInput } from '../../providers/PIELiveAuthorityProvider';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');

const NOW = new Date('2026-09-27T12:00:00.000Z');
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt,
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

// The A10 pass 6 L2 case: phase 1 finished, phase 2 not started; the new master drops phase 1 and moves phase 2, pairing neither.
const before = approve({ items: [], documents: [] }, master, rows(master, [
  'Pour slab,Alpha,Lot,09/01/2026,09/03/2026,100%', 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,0%', 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%',
]));
const phase1 = before.items.filter(item => item.taskName === 'Pour slab').sort((left, right) => left.startDate.localeCompare(right.startDate))[0];
const after = approve(before, master2, rows(master2, ['Pour slab,Alpha,Lot,10/05/2026,10/07/2026,0%', 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%']));
const shown = selectAuthoritativeScheduleItems({ scheduleItems: after.items, scheduleDocuments: after.documents }) as ScheduleItem[];
const report = {
  id: 'u-phase1-complete', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-04T15:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: 'Pour slab is complete. Finished and cured.', scheduleItemId: phase1.id,
  scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
} as ProjectUpdate;

const WRONG = 'Pour slab complete while the schedule remains Not Started at 0%';
const runtimeWith = (known?: ScheduleItem[]) => buildRuntime({
  projectName: 'Alpha', projectNames: ['Alpha'], updates: [report], scheduleItems: shown, knownScheduleItems: known,
  referenceDocuments: after.documents, now: NOW, surface: 'home',
});

describe('A10 p7 L2: the runtime takes every saved task, so the phone and the web agree', () => {
  it('without every saved task the runtime warns about phase 2 (what David saw)', () => {
    const runtime = runtimeWith();
    expect(runtime.fusedEvidence.scheduleReconciliation.warnings.some(warning => warning.summary.includes(WRONG))).toBe(true);
    expect(JSON.stringify(runtime.response.reportDraft)).toContain(WRONG);
  });

  it('with every saved task: no warning in the fused evidence, the conflicts or the report draft', () => {
    const runtime = runtimeWith(after.items);
    expect(runtime.fusedEvidence.scheduleReconciliation.warnings.filter(warning => warning.type === 'field_progress_not_reflected')).toEqual([]);
    expect(runtime.evidenceConflicts.map(conflict => conflict.summary).join(' ')).not.toContain(WRONG);
    expect(JSON.stringify(runtime.response.reportDraft)).not.toContain(WRONG);
    expect(JSON.stringify(runtime.response.reportDraft)).not.toContain('Schedule attention:');
  });

  it('the evidence fusion passes every saved task to its reconciliation', () => {
    const fused = buildFusedEvidence({
      projectName: 'Alpha', projectNames: ['Alpha'], updates: [report], scheduleItems: shown, knownScheduleItems: after.items, now: NOW,
    });
    expect(fused.scheduleReconciliation.warnings.filter(warning => warning.type === 'field_progress_not_reflected')).toEqual([]);
  });

  it('Project Truth\'s risks on the phone (built with the runtime) no longer list the warning', () => {
    const truth = buildDAVEProjectTruth({
      projectId: 'project-alpha', projectName: 'Alpha', updates: [report], scheduleItems: shown, knownScheduleItems: after.items,
      referenceDocuments: after.documents, runtime: runtimeWith(after.items), now: NOW.toISOString(),
    });
    expect(truth.briefing.risksAndConflicts.join(' ')).not.toContain(WRONG);
  });

  it('the live authority hands every saved task to the runtime, and a change to them is a new input', () => {
    const provider = fs.readFileSync(path.resolve(__dirname, '../../providers/PIELiveAuthorityProvider.tsx'), 'utf8');
    const context = provider.slice(provider.indexOf('function providerRuntimeContext('), provider.indexOf('function draftWithContent('));
    expect(context).toMatch(/knownScheduleItems: Array\.isArray\(input\.knownScheduleItems\) \? input\.knownScheduleItems : undefined/);
    const input = {
      projectName: 'Alpha', projectNames: ['Alpha'], updates: [report], scheduleItems: shown, knownScheduleItems: after.items,
    } as unknown as PIELiveAuthorityInput;
    const fewer = { ...input, knownScheduleItems: after.items.filter(item => item.id !== phase1.id) } as PIELiveAuthorityInput;
    expect(authorityInputSignature(fewer)).not.toBe(authorityInputSignature(input));
    expect(authorityInputSignature({ ...input, knownScheduleItems: [...after.items] })).toBe(authorityInputSignature(input));
  });
});
