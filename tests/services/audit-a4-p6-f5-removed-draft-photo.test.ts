/**
 * Whole-app audit A4 pass 6 F5 (30 Sep 2026): removing a photo from the draft
 * deleted its file at once, while the draft reached storage only on the 750 ms
 * timer. A kill inside that window reopened the draft on a deleted file, and
 * saving it marked the photo missing. Runs App.tsx's own removePhoto,
 * persistDraftNow and photo-file deletion, compiled from the source, against
 * a storage write the test holds open.
 */
import { isLegacyOwnedLocalFileReadDeleteAuthorized } from '../../services/OwnedLocalFileRepository';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function declared at the given indent of App.tsx (component scope is two spaces), brace-matched. */
function appFunction(name: string, indent = ''): string {
  const match = new RegExp(`\\n${indent}(?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no function ${name}`);
  const start = match.index + 1;
  const open = app.indexOf(' {\n', start) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced function ${name}`);
}

function compile<T>(sources: string[], names: string[], deps: Record<string, unknown>): T {
  const js = ts.transpileModule(
    [...sources, `module.exports = { ${names.join(', ')} };`].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as T };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}

const PHOTO_STORAGE_DIR = 'file:///var/mobile/Containers/Data/Application/A/Documents/project-photos/';
const DRAFT_STORAGE_KEY = 'draft-key';
const photo = (id: string) => ({ id, uri: `${PHOTO_STORAGE_DIR}${id}.jpg`, caption: '', category: 'Update' });
const baseDraft = () => ({
  id: 'draft-1', projectName: 'P', date: '2026-09-30', notes: 'Pour day', photos: [photo('p1'), photo('p2')],
  recipients: { contactIds: [] as string[] }, documents: [] as unknown[],
});

function harness() {
  const events: string[] = [];
  const stored = new Map<string, string>();
  const pendingWrites: Array<() => void> = [];
  let state = baseDraft();
  const draftRef = { current: state };
  const storedAtDelete: Array<string[] | null> = [];
  const deleteAsync = jest.fn(async (uri: string) => {
    events.push(`delete ${uri.split('/').pop()}`);
    const raw = stored.get(DRAFT_STORAGE_KEY);
    storedAtDelete.push(raw ? (JSON.parse(raw).draft.photos as Array<{ id: string }>).map(item => item.id) : null);
  });
  const deps: Record<string, unknown> = {
    PHOTO_STORAGE_DIR, PHOTO_STORAGE_FOLDER: 'project-photos', DRAFT_STORAGE_KEY,
    isLegacyOwnedLocalFileReadDeleteAuthorized, FileSystem: { deleteAsync },
    draftRef, savedUpdatesRef: { current: [] }, draftSaveTimer: { current: null },
    // The pre-fix removePhoto read these render-time values.
    draft: state, savedUpdates: [],
    setDraft: (next: unknown) => {
      state = typeof next === 'function' ? (next as (prev: typeof state) => typeof state)(state) : next as typeof state;
    },
    setDraftSavedAt: () => undefined,
    photoAnalysisCoordinator: { invalidate: () => undefined },
    authorityProjectId: () => null,
    persistStorageItem: (key: string, value: string) => new Promise<void>(resolve => {
      events.push('write started');
      pendingWrites.push(() => { stored.set(key, value); events.push('written'); resolve(); });
    }),
    removePersistedStorageItem: async (key: string) => { stored.delete(key); },
    reportStoragePersistenceFailure: () => undefined,
  };
  const A = compile<{ removePhoto: (photoId: string) => void }>(
    [
      appFunction('hasMeaningfulDraft'), appFunction('isStoredProjectPhoto'), appFunction('deleteStoredPhotoIfUnused'),
      appFunction('persistDraftNow', '  '), appFunction('removePhoto', '  '),
    ],
    ['removePhoto'],
    deps,
  );
  const storedPhotoIds = () =>
    (JSON.parse(stored.get(DRAFT_STORAGE_KEY) || '{"draft":{"photos":[]}}').draft.photos as Array<{ id: string }>)
      .map(item => item.id);
  return { A, events, deleteAsync, storedAtDelete, pendingWrites, storedPhotoIds, draftRef, state: () => state };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('removing a draft photo (whole-app audit A4 pass 6 F5)', () => {
  it('writes the draft without the photo before the photo file is deleted', async () => {
    const h = harness();
    h.A.removePhoto('p1');
    await flush();
    // A kill now leaves the file on disk: the stored draft is still the old one.
    expect(h.deleteAsync).not.toHaveBeenCalled();
    expect(h.state().photos.map(item => item.id)).toEqual(['p2']);
    expect(h.draftRef.current.photos.map(item => item.id)).toEqual(['p2']);

    h.pendingWrites.forEach(finish => finish());
    await flush();
    expect(h.storedPhotoIds()).toEqual(['p2']);
    expect(h.events).toEqual(['write started', 'written', 'delete p1.jpg']);
  });

  it('two removals before a render: each file goes only once a stored draft no longer holds it', async () => {
    const h = harness();
    h.A.removePhoto('p1');
    h.A.removePhoto('p2');
    await flush();
    expect(h.deleteAsync).not.toHaveBeenCalled();
    for (const finish of h.pendingWrites) {
      finish();
      await flush();
    }
    expect(h.storedPhotoIds()).toEqual([]);
    expect(h.deleteAsync.mock.calls.map(([uri]) => String(uri).split('/').pop()).sort()).toEqual(['p1.jpg', 'p2.jpg']);
    // The second write starts from the first removal's draft, not the rendered one.
    expect(h.storedAtDelete).toEqual([['p2'], []]);
  });
});
