/**
 * Review P4 F2 (6 Oct 2026, Medium; caused by 79a5ae1, owner answer Q28).
 *
 * What David saw: on a master schedule uploaded on the web, the first next
 * step he typed on a task from the phone, or the first link he made from it
 * to another task, vanished from the task, and Review Conflicts showed
 * "Next action: Call the inspector / (none) · Predecessors: 1 item / (none)".
 * Nobody had changed anything anywhere else.
 *
 * Why: the phone holds every task as App.tsx's normalizeScheduleItem leaves
 * it, with each missing field filled in. A row the web's upload wrote has no
 * next step and no links at all. The edit's copy said "blank", the cloud's
 * row said nothing, and compared as stored the two differed: "changed on
 * both". The repo's rigs pass tasks through as they are, so no test saw it.
 *
 * These tests run tasks through the App's own normalizer, compiled from
 * App.tsx, and hold that two copies of a task are compared as the app would
 * read each of them, for every field that normalizer fills in or rewrites.
 */
import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

import { normalizeDAVECompletionVerification } from '../../services/DAVECompletionVerification';
import { prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { normalizeImportedScheduleNote, normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { parseMonthNameDateParts, projectTimeZoneOrDefault } from '../../services/ProjectDateTime';
import { normalizeProjectItemActivity, normalizeProjectItemType } from '../../services/ProjectItemWorkflow';
import { optionalString, uid } from '../../services/RecordValues';
import { canonicalScheduleItemJson } from '../../services/ScheduleItemCloudAcknowledgement';
import {
  scheduleItemEditAgainstCloud, scheduleItemEditBase, scheduleItemFieldAsRead, scheduleItemWholeCopyAgainstCloud, scheduleItemWholeCopyBase,
  scheduleItemWholeCopyRestUnchanged,
} from '../../services/ScheduleItemEditBase';
import { reconcileScheduleProgress } from '../../services/ScheduleProgressInvariant';
import { normalizeProjectControls, reviseProjectControls } from '../../services/VitruviusProjectControls';
import { normalizeScheduleDependencies } from '../../services/VitruviusScheduleEngine';
import type { ScheduleItem } from '../../types';

/* The App's own normalizer, compiled from App.tsx ----------------------------------------------------------------- */
const APP = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
function appFunction(name: string): string {
  const match = new RegExp(`\\n(?:export )?(?:async )?function ${name}\\(`).exec(APP);
  if (!match) throw new Error(`App.tsx has no function ${name}`);
  const rest = APP.slice(match.index + 1).replace(/^export /, '');
  const end = rest.slice(1).search(/\n(?:export )?(?:async )?function |\n(?:export )?const |\n(?:export )?type |\ninterface |\n\/\*\*/);
  return rest.slice(0, end < 0 ? undefined : end + 1);
}
function appConstant(name: string): string {
  const match = new RegExp(`\\nconst ${name}[:= ][^;]*;`).exec(APP);
  if (!match) throw new Error(`App.tsx has no constant ${name}`);
  return match[0];
}
const appNormalize: (value: Partial<ScheduleItem>) => ScheduleItem = (() => {
  const source = [appConstant('SCHEDULE_PRIORITIES'), appConstant('zeroPad'), appFunction('parseFlexibleDate'), appFunction('formatAppDate'),
    appFunction('normalizeScheduleItem'), 'module.exports = { normalizeScheduleItem };'].join('\n');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const deps: Record<string, unknown> = {
    reconcileScheduleProgress, uid, optionalString, normalizeProjectItemType, normalizeProjectItemActivity, projectTimeZoneOrDefault,
    normalizeScheduleDependencies, normalizeImportedScheduleNote, normalizeProjectControls, normalizeDAVECompletionVerification, parseMonthNameDateParts,
  };
  const mod = { exports: {} as { normalizeScheduleItem: (value: Partial<ScheduleItem>) => ScheduleItem } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports.normalizeScheduleItem;
})();

type Row = Record<string, unknown>;
const asRow = (item: unknown) => item as Row;
const read = (row: Row, field: string) => canonicalScheduleItemJson({ value: scheduleItemFieldAsRead(field, row[field]) ?? null });

/* Rows as each writer saves them ------------------------------------------------------------------------------------ */
/** A master's row as the web's upload writes it to the cloud: no next step, no links, no controls. */
const webUploadRow = asRow((prepareDAVEWebDocumentUpload({
  fileName: 'MASTER G.csv', mimeType: 'text/csv', sizeBytes: 300, category: 'Schedules', projectName: 'Alpha', projects: ['Alpha'],
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', 'Framing,Alpha,Lot,10/20/2026,10/30/2026,', 'Survey,Alpha,Lot,10/12/2026,10/14/2026,'].join('\n'),
  fingerprint: 'd'.repeat(64), now: '2026-09-10T18:00:00.000Z',
} as never).scheduleItems as ScheduleItem[])[0]);
/** A row as a schedule file's import makes it on the phone, before the app has read it back. */
const importRow = asRow({
  ...(normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', 'Framing,Alpha,Lot,10/15/2026,10/25/2026,'].join('\n'), sourceName: 'MASTER F.csv',
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date('2026-09-07T12:00:00.000Z'),
  }).items as ScheduleItem[])[0], id: 'MASTER F-1',
});
/** As little as a row can hold. */
const bareRow: Row = { id: 'X-1', taskName: 'Framing', createdAt: '2026-09-07T12:00:00.000Z' };
/** A row holding each field in a form the app rewrites when it reads it. */
const oddRow: Row = {
  id: 'X-2', taskName: 'Framing', createdAt: '2026-09-07T12:00:00.000Z', projectName: 'Alpha', locationName: 'Lot',
  startDate: '2026-10-20', finishDate: 'Oct 30, 2026', owner: '   ', contractor: null, milestone: undefined, notes: null, nextAction: '  ',
  dependencies: [{ predecessorItemId: ' MASTER F-2 ' }, { predecessorItemId: '' }], activity: null, isSummary: null, isMilestone: 'yes', itemType: 'Nothing',
  priority: 'Urgent', projectControls: null, projectTimeZone: 'Nowhere/None', wbsCode: '', parentItemId: '  ', sortOrder: null, durationDays: null,
  baselineStartDate: '', baselineFinishDate: null, scheduleProjectName: '', progressSource: 'nobody', importedFrom: '', percentComplete: 0, status: 'Not Started',
};
const SAMPLES: ReadonlyArray<readonly [string, Row]> = [
  ['a row the web\'s upload wrote', webUploadRow], ['a row a schedule import made', importRow], ['a bare row', bareRow], ['a row in other writings', oddRow],
];

describe('Review P4 F2: two copies of a task are compared as the app reads each of them', () => {
  it('the fields the App\'s normalizer fills in on a row that lacks them (a new one here must be read alike too)', () => {
    const filledIn = Object.keys(appNormalize(bareRow as Partial<ScheduleItem>)).filter(field => !(field in bareRow)).sort();
    expect(filledIn).toEqual([
      'activity', 'baselineFinishDate', 'baselineStartDate', 'completionVerification', 'contractor', 'dependencies', 'durationDays', 'finishDate',
      'importBatchId', 'importedAt', 'importedFrom', 'isMilestone', 'isSummary', 'itemType', 'locationName', 'milestone', 'nextAction', 'notes', 'owner',
      'parentItemId', 'percentComplete', 'priority', 'progressConfirmedAt', 'progressConfirmedBy', 'progressSource', 'projectControls', 'projectId', 'projectName',
      'projectTimeZone', 'scheduleProjectName', 'sortOrder', 'sourceActivityId', 'sourceDocumentId', 'sourceRowNumber', 'sourceWbsCode', 'startDate', 'status',
      'updatedAt', 'wbsCode',
    ]);
    // And on the row the web's upload writes: these are the fields the phone's copy holds and the cloud's row does not.
    const onWebRow = Object.keys(appNormalize(webUploadRow as Partial<ScheduleItem>)).filter(field => !(field in webUploadRow)).sort();
    expect(onWebRow).toEqual(expect.arrayContaining(['activity', 'dependencies', 'isMilestone', 'isSummary', 'itemType', 'nextAction', 'projectControls', 'projectTimeZone']));
  });

  it.each(SAMPLES)('%s reads the same, field by field, before and after the App\'s normalizer has read it', (_label, row) => {
    const held = asRow(appNormalize(row as Partial<ScheduleItem>));
    const differing = [...new Set([...Object.keys(row), ...Object.keys(held)])].sort().filter(field => read(row, field) !== read(held, field));
    // (progressSource 'nobody' and a time zone that is none are not values any writer saves; the app drops them.)
    expect(differing.filter(field => !(row === oddRow && field === 'progressSource'))).toEqual([]);
  });

  /** Each field of a task David can change, with a value to change it to. */
  const survey = 'MASTER G-2';
  const EDITS: ReadonlyArray<readonly [string, unknown]> = [
    ['nextAction', 'Call the inspector'], ['dependencies', [{ predecessorItemId: survey, type: 'FS', lagDays: 0 }]], ['owner', 'Mike'], ['contractor', 'Acme Framing'],
    ['milestone', 'Topping out'], ['notes', 'Crew short Tuesday'], ['priority', 'High'], ['itemType', 'Issue'], ['isMilestone', true], ['isSummary', true],
    ['wbsCode', '1.2.3'], ['parentItemId', survey], ['sortOrder', 4], ['durationDays', 12], ['baselineStartDate', '10/20/2026'], ['baselineFinishDate', '10/30/2026'],
    ['locationName', 'Roof'], ['startDate', '10/21/2026'], ['finishDate', '10/31/2026'],
  ];

  it.each(EDITS)('his first %s on a task the web\'s upload wrote goes up: nothing is asked, nothing is held back', (field, value) => {
    const held = appNormalize(webUploadRow as Partial<ScheduleItem>);
    const edited = appNormalize({ ...held, [field]: value, updatedAt: '2026-09-11T09:00:00.000Z' } as Partial<ScheduleItem>);
    const changedFields = Object.keys(edited).filter(name => JSON.stringify(asRow(edited)[name]) !== JSON.stringify(asRow(held)[name]));
    expect(changedFields).toContain(field);
    // (It was, for a next step and for links: asked ["nextAction"] / ["dependencies"].)
    const weighed = scheduleItemEditAgainstCloud(edited, changedFields, scheduleItemEditBase(held, changedFields), webUploadRow as unknown as ScheduleItem);
    expect([weighed.asked, weighed.keptFromCloud, weighed.held]).toEqual([[], [], []]);
    expect(asRow(weighed.itemData)[field]).toEqual(asRow(edited)[field]);
  });

  it('and when a whole copy of that task goes up (a lookahead approved, Set Active): its fields are weighed alike, and the rest of the cloud\'s row reads as unchanged', () => {
    const held = appNormalize(webUploadRow as Partial<ScheduleItem>);
    const base = scheduleItemWholeCopyBase(held);
    // (It was: the phone's copy holds an empty activity list, the blank controls and a time zone; the cloud's row none.)
    expect(scheduleItemWholeCopyRestUnchanged(base, webUploadRow as unknown as ScheduleItem)).toBe(true);
    const copy = appNormalize({ ...held, nextAction: 'Call the inspector', dependencies: [{ predecessorItemId: survey, type: 'FS', lagDays: 0 }], updatedAt: '2026-09-11T09:00:00.000Z' } as Partial<ScheduleItem>);
    const weighed = scheduleItemWholeCopyAgainstCloud(copy, copy, base, webUploadRow as unknown as ScheduleItem);
    expect([weighed.asked, weighed.sentHere]).toEqual([[], ['nextAction', 'dependencies']]);
    // A real change to the rest still reads as one.
    expect(scheduleItemWholeCopyRestUnchanged(base, { ...webUploadRow, percentComplete: 40, status: 'In Progress' } as unknown as ScheduleItem)).toBe(false);
  });

  it('the web then saves the task (its save writes every field): still nothing to ask about a field the web left as it was', () => {
    const held = appNormalize(webUploadRow as Partial<ScheduleItem>);
    const savedOnWeb = { ...webUploadRow, nextAction: '', dependencies: [], activity: [], percentComplete: 20, status: 'In Progress', projectControls: normalizeProjectControls(null) };
    const edited = appNormalize({ ...held, nextAction: 'Call the inspector' } as Partial<ScheduleItem>);
    expect(scheduleItemEditAgainstCloud(edited, ['nextAction', 'updatedAt'], scheduleItemEditBase(held, ['nextAction', 'updatedAt']), savedOnWeb as unknown as ScheduleItem).asked).toEqual([]);
  });

  it('a field really changed on both is still asked about, and one only the other device changed still stays the cloud\'s', () => {
    const held = appNormalize(webUploadRow as Partial<ScheduleItem>);
    const typedOnWeb = { ...webUploadRow, nextAction: 'Order rebar', owner: 'Ana' } as unknown as ScheduleItem;
    const edited = appNormalize({ ...held, nextAction: 'Call the inspector' } as Partial<ScheduleItem>);
    const weighed = scheduleItemEditAgainstCloud(edited, ['nextAction', 'owner', 'updatedAt'], scheduleItemEditBase(held, ['nextAction', 'owner', 'updatedAt']), typedOnWeb);
    expect([weighed.asked, weighed.keptFromCloud]).toEqual([['nextAction'], ['owner']]);
  });

  it('his project controls on such a task: set from the blank ones the app fills in, they go up, merged as ever and never asked about', () => {
    const held = appNormalize(webUploadRow as Partial<ScheduleItem>);
    const controls = reviseProjectControls({ current: held.projectControls, patch: { approvalStatus: 'Pending' }, actor: 'David', now: '2026-09-11T09:00:00.000Z' });
    const edited = appNormalize({ ...held, projectControls: controls } as Partial<ScheduleItem>);
    const weighed = scheduleItemEditAgainstCloud(edited, ['projectControls', 'updatedAt'], scheduleItemEditBase(held, ['projectControls', 'updatedAt']), webUploadRow as unknown as ScheduleItem);
    expect([weighed.asked, weighed.keptFromCloud]).toEqual([[], []]);
    expect(normalizeProjectControls(weighed.itemData.projectControls).approvalStatus).toBe('Pending');
  });
});
