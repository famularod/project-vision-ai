/**
 * Everyday item 8 (2 Oct 2026): Field Activity's Drafts tab had no row for
 * the update open on this phone (photos taken, not yet saved or sent). It is
 * listed now, first: opening it resumes it, deleting it is the draft's own
 * Discard. The list filter is the real one; openSavedUpdate runs compiled
 * from App.tsx, as in the A4 and A8 tests.
 */
import { filterDAVEUpdateWorkspace } from '../../services/DAVEUpdateWorkspace';
import { isOpenDraftRow, updatesWithOpenDraft } from '../../services/FieldUpdateOpenDraftRow';
import { isResumableFieldUpdateStatus } from '../../services/FieldUpdateLifecycle';

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

type Update = { id: string; projectName: string; status: string; date: string; photos: unknown[]; notes: string; isArchived?: boolean };
const update = (id: string, status: string, extra: Partial<Update> = {}): Update => ({
  id, projectName: 'Tower', status, date: '2026-10-02', photos: [], notes: '', ...extra,
});
const drafts = (updates: readonly Update[]) => filterDAVEUpdateWorkspace({
  updates: updates as never,
  activeTab: 'Drafts',
  filters: { project: null, areaId: null, pieStatus: null, lifecycleStatus: null, withinDays: null },
  searchText: '',
  contactNameForId: () => '',
  lifecycleForUpdate: (item: object) => (item as { status: string }).status,
  pieStatusForUpdate: () => null as never,
  updateNeedsAction: () => false,
  withinDaysMatches: () => true,
  updateTime: () => 0,
}).map(item => (item as unknown as Update).id);

describe('the Drafts tab lists the update open on this phone (everyday item 8)', () => {
  it('first, as a draft, when it has work in it; not twice once saved; not when empty', () => {
    const saved = [update('saved-draft', 'draft'), update('sent-1', 'sent')];
    // In review (ready to send) or still adding photos, it is this phone's open draft.
    const open = update('open-1', 'ready_to_send', { photos: [{}], notes: 'Slab edge' });
    expect(drafts(updatesWithOpenDraft(saved, open, true))).toEqual(['open-1', 'saved-draft']);
    expect(updatesWithOpenDraft(saved, open, true)[0]).toMatchObject({ id: 'open-1', status: 'draft', notes: 'Slab edge' });
    // A resumed saved draft already has its row.
    const resumed = { ...saved[0], notes: 'edited since' };
    expect(updatesWithOpenDraft(saved, resumed, true)).toBe(saved);
    // An empty new draft is not listed.
    expect(updatesWithOpenDraft(saved, update('blank', 'draft'), false)).toBe(saved);
    // Delete on its row is the draft's Discard; on a saved row it is the saved update's delete.
    expect(isOpenDraftRow(saved, open, 'open-1')).toBe(true);
    expect(isOpenDraftRow(saved, resumed, 'saved-draft')).toBe(false);
    expect(isOpenDraftRow(saved, open, 'sent-1')).toBe(false);
  });

  it('opening its row resumes the open draft where it was (the App\'s own openSavedUpdate)', () => {
    const open = update('open-1', 'draft', { photos: [{}] });
    const calls: string[] = [];
    const deps: Record<string, unknown> = {
      lifecycleStatusForUpdate: (item: Update) => item.status,
      isResumableFieldUpdateStatus,
      updateDetailReturnScreenRef: { current: 'Home' },
      setSelectedWorkspaceProject: (name: string) => calls.push(`project:${name}`),
      setSelectedDetailUpdate: () => calls.push('detail'),
      setScreen: (screen: string) => calls.push(`screen:${screen}`),
      draftRef: { current: open },
      draft: open,
      screenForUpdateResume: () => 'BuildUpdate',
      hasDraftContent: () => true,
      Alert: { alert: () => calls.push('alert') },
    };
    const js = ts.transpileModule(
      `${componentFunction('openSavedUpdate')}\nmodule.exports = { openSavedUpdate };`,
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
    ).outputText;
    const mod = { exports: {} as { openSavedUpdate: (item: Update) => void } };
    new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
    mod.exports.openSavedUpdate(updatesWithOpenDraft([], open, true)[0]);
    // Straight back to it: no "Unfinished update found" replacing it, no detail screen.
    expect(calls).toEqual(['project:Tower', 'screen:BuildUpdate']);
  });

  it('the App gives Field Activity the open draft, and its Delete discards it', () => {
    expect(app).toContain('updates={updatesWithOpenDraft(savedUpdates, draft, hasMeaningfulDraft(draft))}');
    expect(app).toContain('onDelete={updateId => (isOpenDraftRow(savedUpdates, draft, updateId) ? discardDraft() : deleteSavedUpdate(updateId))}');
  });
});
