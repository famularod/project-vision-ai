/**
 * Audit round 2, A8 pass 7 L2 (30 Sep 2026), left by 174c05a: the import
 * review checked a different list than the pick. The pick checks every
 * saved document (App.tsx prepareScheduleImportFromAsset); the review got the
 * Schedule screen's list, which keeps only the Schedules category. With
 * Alpha's shown schedule a current document filed under another category
 * with "schedule" in its name, the pick offered the old master F's file as a
 * lookahead, and Accept then refused both choices with the Set Active
 * message. The review now gets the same full list. Synthetic data only.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import type { PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { scheduleImportRoleRefusal, suggestScheduleImportRole } from '../../services/ScheduleLookahead';
import { resolveScheduleImportSourceIdentity } from '../../services/ScheduleImportSourceIdentity';
import { scheduleImportOfFile } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const document = (id: string, importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...extra,
}) as ReferenceDocument;
const row = (id: string, taskName: string, batchId: string) => ({
  id, taskName, projectName: 'Alpha', locationName: 'Lot', startDate: '10/01/2026', finishDate: '10/03/2026', milestone: '',
  owner: 'David', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
  createdAt: '2026-09-30T12:00:00.000Z', importBatchId: batchId,
}) as ScheduleItem;

const bytes = new TextEncoder().encode('Task,Project,Area,Start,Finish\nPour slab,Alpha,Lot,10/01/2026,10/03/2026');
const projects = [{ id: 'alpha-id', name: 'Alpha' }];
const identity = resolveScheduleImportSourceIdentity({ bytes, projects, documentIdIsDeleted: () => false });
// The old master F, retired once Alpha's newer schedule was made current.
const savedF = document(identity.documentId, '2026-08-31T12:00:00.000Z', {
  name: 'MASTER F 0831', isCurrent: false, importBatchId: identity.batchId, contentSha256: identity.contentSha256,
});
// Alpha's shown schedule, a current document filed under Other with "Schedule" in its name.
const alphaShown = document('alpha-other', '2026-09-26T12:00:00.000Z', { name: 'Alpha Schedule rev 3', category: 'Other' });
const drawing = document('e-601', '2026-09-01T12:00:00.000Z', { name: 'E-601', category: 'Drawing', isCurrent: true });
const referenceDocuments = [savedF, alphaShown, drawing];

/** The documents App.tsx hands the import review, evaluated from App.tsx itself with these documents. */
function reviewDocumentsFromApp(): ReferenceDocument[] {
  const screenStart = app.indexOf('\nfunction ScheduleScreen(');
  const prop = /roleContext=\{\{ documents: (\w+),/.exec(app.slice(screenStart))?.[1];
  if (!prop) throw new Error('roleContext documents not found in ScheduleScreen');
  const usage = app.indexOf('<ScheduleScreen\n');
  const start = app.indexOf(`\n              ${prop}={`, usage);
  if (usage < 0 || start < 0 || start > app.indexOf('/>', app.indexOf('onOpenUpdate=', usage))) throw new Error(`${prop} not passed to ScheduleScreen`);
  let depth = 0;
  let index = app.indexOf('{', start);
  const from = index + 1;
  for (; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') depth -= 1;
    if (depth === 0) break;
  }
  const js = ts.transpileModule(`module.exports = (${app.slice(from, index)});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: [] as unknown };
  new Function('module', 'exports', 'referenceDocuments', js)(mod, mod.exports, referenceDocuments);
  return mod.exports as ReferenceDocument[];
}

// F's file picked again, as the pick builds it when it is offered as a lookahead.
const again: PIEScheduleImportBatch = {
  id: 'batch-again', kind: 'schedule_file', sourceCount: 1, sourceLabel: 'MASTER F 0831.csv', message: 'Two activities extracted.',
  documents: [document('again', '2026-09-30T12:00:00.000Z', { name: 'MASTER F 0831', importBatchId: 'batch-again', scheduleRole: 'lookahead', contentSha256: identity.contentSha256 })],
  items: [row('a-1', 'Pour slab', 'batch-again'), row('a-2', 'Frame walls', 'batch-again')],
};

describe('A8 pass 7 L2: the import review checks the same documents as the pick', () => {
  it('the pick, checking every document, offers F\'s file as a lookahead', () => {
    expect(scheduleImportOfFile({
      bytes, projects, documentIdIsDeleted: () => false, documents: referenceDocuments, scheduleItems: [], projectNames: ['Alpha'],
    })).toMatchObject({ alreadyImported: false, asLookahead: true });
  });

  it('the review App.tsx opens gets the same list, so it accepts the lookahead the pick offered', () => {
    const documents = reviewDocumentsFromApp();
    expect(documents.map(item => item.id)).toEqual(expect.arrayContaining([savedF.id, alphaShown.id]));
    expect(suggestScheduleImportRole({ batch: again, documents, scheduleItems: [] }).reason)
      .toBe('this exact file is already saved as a full schedule for these projects, so it can only be added again as a lookahead');
    expect(scheduleImportRoleRefusal(again, 'lookahead', documents)).toBeNull();
  });

  it('rendered with that list, Accept saves it as a lookahead', async () => {
    const onApprove = jest.fn(async (_batch: PIEScheduleImportBatch) => undefined);
    const view = render(
      <ScheduleImportFlow
        screenshotImportAvailable={false}
        onImportFile={jest.fn(async () => null)}
        onImportScreenshots={jest.fn(async () => null)}
        onAddManually={jest.fn()}
        onApprove={onApprove}
        onCancel={jest.fn()}
        incomingBatch={again}
        onIncomingBatchConsumed={jest.fn()}
        roleContext={{ documents: reviewDocumentsFromApp(), items: [] }}
      />,
    );
    await view.findByText('How should Vitruvius use this schedule?');
    await act(async () => {
      fireEvent.press(view.getByText('Accept All (2)'));
      await Promise.resolve();
    });
    expect(onApprove.mock.calls.map(call => call[0].documents.map(item => item.scheduleRole))).toEqual([['lookahead']]);
    view.unmount();
  });
});
