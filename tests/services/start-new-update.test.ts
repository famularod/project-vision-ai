import fs from 'fs';
import path from 'path';

import { startNewUpdate } from '../../services/StartNewUpdate';

type Draft = { id: string; projectName: string; photos: { uri: string }[] };

const unfinished: Draft = {
  id: 'draft-old',
  projectName: '2321 Compliance Project',
  photos: [{ uri: 'file:///photos/a.jpg' }, { uri: 'file:///photos/b.jpg' }],
};

// A stand-in for the App shell: the current draft, the screen, and every
// photo file deleted, with whether the current draft still pointed at it.
function shell(initialDraft: Draft) {
  const state = {
    draft: initialDraft,
    screen: 'Home',
    calls: [] as string[],
    deleted: [] as string[],
    deletedWhileReferenced: [] as string[],
  };
  const start = (target: string | null, discardedDraft: Draft | null) =>
    startNewUpdate<Draft>({
      target,
      discardedDraft,
      beginDraftForProject: projectName => {
        state.calls.push('beginDraftForProject');
        state.draft = { id: `draft-${projectName}`, projectName, photos: [] };
        state.screen = 'AddPhotos';
      },
      replaceDraftWithBlank: () => {
        state.calls.push('replaceDraftWithBlank');
        state.draft = { id: 'draft-blank', projectName: '', photos: [] };
      },
      openProjectPicker: () => {
        state.calls.push('openProjectPicker');
        state.screen = 'SelectProject';
      },
      deleteDiscardedPhotos: discarded => {
        state.calls.push('deleteDiscardedPhotos');
        for (const photo of discarded.photos) {
          state.deleted.push(photo.uri);
          if (state.draft.photos.some(item => item.uri === photo.uri)) {
            state.deletedWhileReferenced.push(photo.uri);
          }
        }
      },
    });
  return { state, start };
}

describe('Start New over an unfinished draft', () => {
  it('with no confident project, replaces the draft before the picker opens and before any file is deleted', () => {
    const { state, start } = shell(unfinished);

    start(null, unfinished);

    expect(state.screen).toBe('SelectProject');
    expect(state.calls).toEqual(['replaceDraftWithBlank', 'openProjectPicker', 'deleteDiscardedPhotos']);
    expect(state.deleted).toEqual(['file:///photos/a.jpg', 'file:///photos/b.jpg']);
    expect(state.deletedWhileReferenced).toEqual([]);

    // The PM leaves the picker from the nav bar without choosing a project.
    state.screen = 'Home';
    expect(state.draft.id).not.toBe(unfinished.id);
    expect(state.draft.photos.filter(photo => state.deleted.includes(photo.uri))).toEqual([]);
  });

  it('with a confident project, begins that project draft first and deletes the old files after', () => {
    const { state, start } = shell(unfinished);

    start('2375 Compliance Project', unfinished);

    expect(state.screen).toBe('AddPhotos');
    expect(state.draft.id).toBe('draft-2375 Compliance Project');
    expect(state.calls).toEqual(['beginDraftForProject', 'deleteDiscardedPhotos']);
    expect(state.deleted).toHaveLength(2);
    expect(state.deletedWhileReferenced).toEqual([]);
  });

  it('with nothing to discard, leaves the current draft alone and deletes nothing', () => {
    const empty: Draft = { id: 'draft-empty', projectName: 'Canopy D', photos: [] };
    const picker = shell(empty);

    picker.start(null, null);

    expect(picker.state.calls).toEqual(['openProjectPicker']);
    expect(picker.state.draft).toBe(empty);

    const direct = shell(empty);
    direct.start('Canopy D', null);

    expect(direct.state.calls).toEqual(['beginDraftForProject']);
    expect(direct.state.deleted).toEqual([]);
  });
});

describe('App.tsx createNewUpdate wiring', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
  const start = app.indexOf('  function createNewUpdate(projectName?: string) {');
  const body = app.slice(start, app.indexOf('  function createNewUpdateForScheduleTask(', start));

  it('routes Start New through startNewUpdate with the draft being replaced', () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toMatch(/startNewUpdate\(\{/);
    expect(body).toMatch(/text: 'Start New',[\s\S]*?onPress: \(\) => proceed\(draft\),/);
    expect(body).toMatch(/\n    proceed\(null\);\n  \}/);
  });

  it('opens the picker, blanks the draft and deletes files only as startNewUpdate steps', () => {
    expect(body).toMatch(/replaceDraftWithBlank: \(\) => \{\n\s+const blank = createDraft\(/);
    expect(body.match(/setScreen\('SelectProject'\)/g)).toEqual(["setScreen('SelectProject')"]);
    expect(body).toMatch(/openProjectPicker: \(\) => setScreen\('SelectProject'\),/);
    // Audit A4 (29 Sep 2026): the files go only after the replacement draft is on disk, through discardDraftAfterReplacement.
    expect(body.match(/deleteUnreferencedPhotosFromUpdate\(/g)).toBeNull();
    expect(body).toMatch(/deleteDiscardedPhotos: discardDraftAfterReplacement,/);
  });
});
