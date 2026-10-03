/**
 * Whole-app audit A2 pass 4 L1 (30 Sep 2026): a Project controls field saved
 * as its task closes could put back the other device's older values for the
 * task's other controls. David types in "Assigned to"; another device changes
 * something else on the same task (Approval -> Approved and a trade, or the
 * RFI closed), and that change also takes the task out of his view. The field
 * is removed and saved in that same render with the controls as they were on
 * screen before the other device's change, and App.tsx updateScheduleItem
 * replaced projectControls whole: Approval and Trade went back on the phone,
 * and a closed RFI refused the typed text with "Workflow action required".
 * Runs App.tsx's own updateScheduleItem, compiled from the source, under the
 * real task editor (ProjectItemDetailsEditor -> ProjectControlsEditor), the
 * real workflow rules and the real merge. Synthetic task text only.
 */
import { fireEvent, render } from '@testing-library/react-native';

import { ProjectItemDetailsEditor } from '../../components/project-item-details';
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import { resolveProjectItemWorkflowMutation } from '../../services/ProjectItemWorkflow';
import {
  createScheduleItemTextSyncLifecycle,
  markScheduleItemTextSyncPending,
  scheduleItemChangeUsesDebouncedSync,
} from '../../services/ScheduleItemTextSyncLifecycle';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
import {
  mergeProjectControlsEdit,
  mergeProjectControlsRevisions,
  normalizeProjectControls,
  reviseProjectControls,
  withProjectControlsEditMerged,
} from '../../services/VitruviusProjectControls';
import type { ProjectControls, ScheduleItem } from '../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function of the App component (two-space indent), brace-matched. */
function componentFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no component function ${name}`);
  const open = app.indexOf(' {\n', match.index) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(match.index + 3, index + 1);
    }
  }
  throw new Error('unbalanced function');
}

type UpdateScheduleItem = (
  itemId: string,
  next: Partial<ScheduleItem>,
  workflowRequest?: Parameters<typeof resolveProjectItemWorkflowMutation>[0]['request'],
) => void;

function appTaskUpdate(items: ScheduleItem[]) {
  const alerts: Array<[string, string]> = [];
  const queued: ScheduleItem[] = [];
  let shown = items;
  const scheduleItemsCurrentRef = { current: items };
  const noop = () => undefined;
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef,
    reconcileScheduleProgressEdit,
    // App's normalizeScheduleItem, reduced to the part this edit relies on.
    normalizeScheduleItem: (value: ScheduleItem) => ({
      ...value,
      projectControls: normalizeProjectControls(value.projectControls),
    }),
    displayName: 'David',
    resolveProjectItemWorkflowMutation,
    withProjectControlsEditMerged,
    Alert: { alert: (title: string, message: string) => { alerts.push([title, message]); } },
    advanceScheduleItemSyncGeneration: () => 1,
    markScheduleItemsAuthorityReady: noop,
    setScheduleItems: (update: (previous: ScheduleItem[]) => ScheduleItem[]) => {
      shown = update(shown);
    },
    scheduleItemChangeUsesDebouncedSync,
    markScheduleItemTextSyncPending,
    scheduleItemTextSyncLifecycleRef: { current: createScheduleItemTextSyncLifecycle() },
    queueScheduleItemRecord: async (item: ScheduleItem) => { queued.push(item); },
    queueDebouncedScheduleItemTextSync: noop,
    scheduleItemSyncGenerationsRef: { current: new Map<string, number>() },
    cancelScheduleItemTextSync: noop,
    syncScheduleItemRevision: async () => undefined,
  };
  const js = ts.transpileModule(
    [componentFunction('updateScheduleItem'), 'module.exports = { updateScheduleItem };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as { updateScheduleItem: UpdateScheduleItem } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return {
    updateScheduleItem: mod.exports.updateScheduleItem,
    scheduleItemsCurrentRef,
    alerts,
    queued,
    shown: () => shown,
  };
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const TASK: ScheduleItem = {
  id: 'submittal-14',
  itemType: 'Submittal',
  projectName: '2321 Compliance Project',
  locationName: 'North Lot',
  taskName: 'Rebar shop drawings',
  startDate: '09/28/2026',
  finishDate: '10/02/2026',
  milestone: '',
  owner: 'David',
  contractor: 'General Contractor',
  percentComplete: 20,
  priority: 'Medium',
  status: 'In Progress',
  notes: '',
  nextAction: '',
  activity: [],
  createdAt: '2026-09-28T12:00:00.000Z',
  // Revision 1, on both devices.
  projectControls: reviseProjectControls({
    current: null,
    patch: { referenceNumber: 'SUB-014' },
    actor: 'David',
    now: minutesAgo(30),
  }),
};

/** The other device's change, made with the same editor rules. */
function changedOnIPad(
  item: ScheduleItem,
  patches: Partial<ProjectControls>[],
  extra: Partial<ScheduleItem> = {},
): ScheduleItem {
  const projectControls = patches.reduce<ProjectControls>(
    (controls, patch, index) => reviseProjectControls({
      current: controls,
      patch,
      actor: 'Ann (iPad)',
      now: minutesAgo(5 - index),
    }),
    normalizeProjectControls(item.projectControls),
  );
  return { ...item, ...extra, projectControls };
}

/** The task editor as a task row shows it, routed to App's task update. */
function Row({
  item,
  open,
  update,
}: {
  item: ScheduleItem;
  open: boolean;
  update: UpdateScheduleItem;
}) {
  return open ? (
    <ProjectItemDetailsEditor
      item={item}
      activityAuthor="David"
      onUpdate={(next, workflowRequest) => update(item.id, next, workflowRequest)}
    />
  ) : null;
}

/**
 * David types in "Assigned to"; the other device's change arrives and, in
 * the same render, takes the task out of his view (Open Tasks, deselect).
 */
function typeThenNewerCopyClosesTheRow(base: ScheduleItem, newer: ScheduleItem) {
  const harness = appTaskUpdate([base]);
  const view = render(<Row item={base} open update={harness.updateScheduleItem} />);
  fireEvent.press(view.getByRole('button', { name: /Project controls/i }));
  const assignee = view.getByPlaceholderText('Person responsible');
  fireEvent(assignee, 'focus');
  fireEvent.changeText(assignee, 'Maria');
  // App's render sets the current-items ref to what it shows.
  harness.scheduleItemsCurrentRef.current = [newer];
  view.rerender(<Row item={newer} open={false} update={harness.updateScheduleItem} />);
  return harness;
}

describe('a Project controls field saved as its task closes keeps the other device\'s newer controls (audit A2 pass 4 L1)', () => {
  beforeEach(() => noteSignedInOwner('owner-a'));

  it('Approval and Trade changed on the iPad stay; the typed name is saved', () => {
    const newer = changedOnIPad(TASK, [{ approvalStatus: 'Approved' }, { trade: 'XYZ Rebar' }]);
    expect(newer.projectControls).toMatchObject({ approvalStatus: 'Approved', trade: 'XYZ Rebar', revision: 3 });

    const harness = typeThenNewerCopyClosesTheRow(TASK, newer);

    expect(harness.alerts).toEqual([]);
    const saved = harness.scheduleItemsCurrentRef.current[0].projectControls;
    expect(saved).toMatchObject({
      assignee: 'Maria',
      trade: 'XYZ Rebar',
      approvalStatus: 'Approved',
      referenceNumber: 'SUB-014',
      revision: 4,
      updatedBy: 'David',
    });
    expect(saved?.fieldRevisions?.approvalStatus).toEqual(newer.projectControls?.fieldRevisions?.approvalStatus);
    expect(saved?.fieldRevisions?.trade).toEqual(newer.projectControls?.fieldRevisions?.trade);
    expect(saved?.fieldRevisions?.assignee).toMatchObject({ revision: 1, updatedBy: 'David' });
    // What the phone shows and what is queued for the cloud are the same.
    expect(harness.shown()[0].projectControls).toEqual(saved);
    expect(harness.queued.map(item => item.projectControls)).toEqual([saved]);
  });

  it('an RFI closed on the iPad: no "Workflow action required", the typed name is saved and it stays closed', () => {
    const rfi: ScheduleItem = { ...TASK, id: 'rfi-42', itemType: 'RFI', taskName: 'Slab edge detail' };
    const closed = changedOnIPad(rfi, [{ workflowStage: 'Closed' }], {
      status: 'Complete',
      percentComplete: 100,
    });

    const harness = typeThenNewerCopyClosesTheRow(rfi, closed);

    expect(harness.alerts).toEqual([]);
    const saved = harness.scheduleItemsCurrentRef.current[0];
    expect(saved).toMatchObject({ status: 'Complete', percentComplete: 100 });
    expect(saved.projectControls).toMatchObject({ assignee: 'Maria', workflowStage: 'Closed' });
    expect(harness.queued).toHaveLength(1);
  });

  it('an edit made on the copy the phone holds now applies exactly as the editor sent it', () => {
    const harness = appTaskUpdate([TASK]);
    const sent: Partial<ScheduleItem>[] = [];
    const update: UpdateScheduleItem = (id, next, request) => {
      sent.push(next);
      harness.updateScheduleItem(id, next, request);
    };
    const view = render(<Row item={TASK} open update={update} />);
    fireEvent.press(view.getByRole('button', { name: /Project controls/i }));
    fireEvent.press(view.getByRole('radio', { name: 'Pending' }));

    expect(harness.alerts).toEqual([]);
    const saved = harness.scheduleItemsCurrentRef.current[0].projectControls;
    expect(saved).toEqual(sent[0].projectControls);
    expect(saved).toMatchObject({ approvalStatus: 'Pending', referenceNumber: 'SUB-014', revision: 2 });
  });

  it('a closed RFI still refuses a workflow-stage edit made on the closed copy', () => {
    const rfi: ScheduleItem = { ...TASK, id: 'rfi-43', itemType: 'RFI' };
    const closed = changedOnIPad(rfi, [{ workflowStage: 'Closed' }], { status: 'Complete', percentComplete: 100 });
    const harness = appTaskUpdate([closed]);
    harness.updateScheduleItem(closed.id, {
      projectControls: reviseProjectControls({
        current: closed.projectControls,
        patch: { workflowStage: 'Open' },
        actor: 'David',
        now: new Date().toISOString(),
      }),
    });
    expect(harness.alerts.map(([title]) => title)).toEqual(['Workflow action required']);
    expect(harness.scheduleItemsCurrentRef.current[0]).toBe(closed);
  });
});

describe('mergeProjectControlsEdit: an edit built on an older copy over the copy held now', () => {
  const base = normalizeProjectControls(TASK.projectControls);
  const editOf = (from: ProjectControls, patch: Partial<ProjectControls>) => reviseProjectControls({
    current: from,
    patch,
    actor: 'David',
    now: new Date().toISOString(),
  });

  it('with no newer copy, returns the edit itself', () => {
    const edit = editOf(base, { assignee: 'Maria', approvalStatus: 'Pending' });
    expect(mergeProjectControlsEdit(base, edit)).toBe(edit);
    // A whole-object edit (Apply recommended setup, a checklist change) too.
    const whole = editOf(base, { checklist: [{ id: 'c1', label: 'Stamp', completed: false, completedAt: null, completedBy: null }] });
    expect(mergeProjectControlsEdit(base, whole)).toBe(whole);
  });

  it('keeps the newer copy\'s other fields and takes the field the edit changed', () => {
    const held = changedOnIPad(TASK, [{ approvalStatus: 'Approved' }, { trade: 'XYZ Rebar' }]).projectControls!;
    const merged = mergeProjectControlsEdit(held, editOf(base, { assignee: 'Maria' }));
    expect(merged).toMatchObject({
      assignee: 'Maria',
      approvalStatus: 'Approved',
      trade: 'XYZ Rebar',
      referenceNumber: 'SUB-014',
      revision: 4,
      updatedBy: 'David',
    });
    expect(merged.fieldRevisions?.approvalStatus).toEqual(held.fieldRevisions?.approvalStatus);
  });

  it('the edit wins a field the other device changed earlier', () => {
    const held = changedOnIPad(TASK, [{ assignee: 'Ann' }]).projectControls!;
    expect(mergeProjectControlsEdit(held, editOf(base, { assignee: 'Maria' })).assignee).toBe('Maria');
  });

  // Changed deliberately (whole-app audit A2 pass 5 L3, 30 Sep 2026): this
  // pinned 'Ann', and the field went on showing the 'Maria' that was not
  // saved. On the phone a field the edit stamped itself now takes the edit's
  // value; the cloud's later-stamp rule still decides at upload.
  it('a field the edit changed takes the edit\'s value on the phone even when another device stamped it later; the cloud merge still keeps the later one', () => {
    const held = reviseProjectControls({
      current: base,
      patch: { assignee: 'Ann' },
      actor: 'Ann (iPad)',
      now: new Date(Date.now() + 60_000).toISOString(),
    });
    const edit = editOf(base, { assignee: 'Maria' });
    const merged = mergeProjectControlsEdit(held, edit);
    expect(merged.assignee).toBe('Maria');
    expect(merged.fieldRevisions?.assignee).toEqual(edit.fieldRevisions?.assignee);
    expect(mergeProjectControlsRevisions(merged, held).assignee).toBe('Ann');
  });

  it('a stored copy passed whole (as Verify Complete sends the task) is not taken as a fresh edit', () => {
    // The copy the phone stored after David's last edit: its newest stamp is
    // his, so it looks like that edit, but it was not made just now.
    const stored = normalizeProjectControls(editOf(base, { assignee: 'Maria' }));
    const held = reviseProjectControls({
      current: stored,
      patch: { assignee: 'Ann' },
      actor: 'Ann (iPad)',
      now: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(mergeProjectControlsEdit(held, stored).assignee).toBe('Ann');
  });

  it('a field the edit did not change keeps the other device\'s value even when its clock is ahead', () => {
    const held = reviseProjectControls({
      current: base,
      patch: { approvalStatus: 'Approved' },
      actor: 'Ann (iPad)',
      now: new Date(Date.now() + 60_000).toISOString(),
    });
    const merged = mergeProjectControlsEdit(held, editOf(base, { assignee: 'Maria' }));
    expect(merged).toMatchObject({ assignee: 'Maria', approvalStatus: 'Approved', referenceNumber: 'SUB-014' });
    expect(merged.fieldRevisions?.approvalStatus).toEqual(held.fieldRevisions?.approvalStatus);
  });

  it('a field neither copy stamped (written by an older build) keeps the copy held now', () => {
    const legacy = normalizeProjectControls({ ...base, fieldRevisions: undefined, approvalStatus: 'Approved', revision: 3 });
    const staleBase = normalizeProjectControls({ ...base, fieldRevisions: undefined });
    const merged = mergeProjectControlsEdit(legacy, editOf(staleBase, { assignee: 'Maria' }));
    expect(merged).toMatchObject({ assignee: 'Maria', approvalStatus: 'Approved', revision: 4 });
  });

  it('withProjectControlsEditMerged only touches an edit that carries Project controls', () => {
    const notes = { notes: 'Called the fabricator' };
    expect(withProjectControlsEditMerged(TASK, notes)).toBe(notes);
    const held = changedOnIPad(TASK, [{ approvalStatus: 'Approved' }]);
    const edit = { projectControls: editOf(base, { assignee: 'Maria' }) };
    expect(withProjectControlsEditMerged(held, edit).projectControls).toMatchObject({
      assignee: 'Maria',
      approvalStatus: 'Approved',
    });
  });
});

/**
 * Whole-app audit A2 pass 5 L3 (30 Sep 2026): with another device's clock
 * ahead, a typed Project controls field kept showing text that was not
 * saved. The iPad changed "Assigned to" to Ann a moment ago in its own time;
 * David typed Maria on the phone and left the field. The merge kept Ann (the
 * later stamp), the saved value did not change, so the box went on showing
 * Maria, and leaving it again unchanged saved nothing. A field David's edit
 * stamped now takes his value on the phone, so the box shows what was saved.
 */
describe('a typed Project controls field shows what the phone saved when another device\'s clock is ahead (audit A2 pass 5 L3)', () => {
  beforeEach(() => noteSignedInOwner('owner-a'));

  function aheadOnIPad(item: ScheduleItem, patch: Partial<ProjectControls>): ScheduleItem {
    return {
      ...item,
      projectControls: reviseProjectControls({
        current: item.projectControls,
        patch,
        actor: 'Ann (iPad)',
        // A moment ago in the iPad's time, which runs ahead of the phone.
        now: new Date(Date.now() + 2 * 60_000).toISOString(),
      }),
    };
  }

  it('Maria typed over Ann is what the phone saves, shows and queues', () => {
    const fromIPad = aheadOnIPad(TASK, { assignee: 'Ann' });
    const harness = appTaskUpdate([fromIPad]);
    const view = render(<Row item={fromIPad} open update={harness.updateScheduleItem} />);
    fireEvent.press(view.getByRole('button', { name: /Project controls/i }));
    expect(view.getByPlaceholderText('Person responsible').props.value).toBe('Ann');

    const assignee = view.getByPlaceholderText('Person responsible');
    fireEvent(assignee, 'focus');
    fireEvent.changeText(assignee, 'Maria');
    fireEvent(assignee, 'blur');
    // App's render shows what it saved.
    view.rerender(<Row item={harness.shown()[0]} open update={harness.updateScheduleItem} />);

    expect(harness.alerts).toEqual([]);
    const saved = harness.scheduleItemsCurrentRef.current[0].projectControls;
    expect(saved).toMatchObject({ assignee: 'Maria', referenceNumber: 'SUB-014', updatedBy: 'David' });
    expect(view.getByPlaceholderText('Person responsible').props.value).toBe(saved?.assignee);
    expect(harness.queued.map(item => item.projectControls?.assignee)).toEqual(['Maria']);
  });

  it('another field the iPad changed with its clock ahead stays as the iPad left it', () => {
    const fromIPad = aheadOnIPad(TASK, { trade: 'XYZ Rebar' });
    const harness = typeThenNewerCopyClosesTheRow(TASK, fromIPad);
    const saved = harness.scheduleItemsCurrentRef.current[0].projectControls;
    expect(saved).toMatchObject({ assignee: 'Maria', trade: 'XYZ Rebar', referenceNumber: 'SUB-014' });
    expect(saved?.fieldRevisions?.trade).toEqual(fromIPad.projectControls?.fieldRevisions?.trade);
  });
});
