/**
 * Whole-app audit A11 pass 4 L3 (30 Sep 2026): a dictated field note or
 * Project Walk memory lived only in memory until Save. The recording is
 * deleted when the words arrive, so iOS closing the app before Save lost the
 * dictation. The unsaved note and memory are now kept on this phone under the
 * account that wrote them, until Save, discard, an account change or a
 * sign-out. Each "launch" below is a fresh module registry over the same
 * phone storage. Synthetic data only.
 */
const mockPhone = new Map<string, string>();

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: async (key: string) => mockPhone.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockPhone.set(key, value); },
    removeItem: async (key: string) => { mockPhone.delete(key); },
    getAllKeys: async () => [...mockPhone.keys()],
    multiRemove: async (keys: string[]) => { keys.forEach(key => mockPhone.delete(key)); },
  };
  return { __esModule: true, default: api, ...api };
});
jest.mock('../../services/FieldNoteRepository', () => {
  const actual = jest.requireActual('../../services/FieldNoteRepository');
  return {
    ...actual,
    localFieldNoteRepository: {
      list: jest.fn(async () => []),
      save: jest.fn(async (_ownerKey: string, note: unknown) => note),
      replace: jest.fn(async (_ownerKey: string, note: unknown) => note),
    },
  };
});

const NOTE = 'Guardrail missing at the north slab edge';
const KEPT_NOTICE = 'Your unsaved note was kept on this phone. Review it, then save.';
const keptKeys = () => [...mockPhone.keys()].filter(key => key.startsWith('@vitruvius/kept-drafts/'));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** A fresh app process: new modules, same phone storage. */
function launch() {
  jest.resetModules();
  const React = require('react');
  const rtl = require('@testing-library/react-native/pure');
  const { FieldNotesWorkspace } = require('../../components/field-notes-workspace');
  const draft = require('../../hooks/use-field-note-draft');
  const notes = (ownerKey: string) => React.createElement(FieldNotesWorkspace, {
    ownerKey, projects: ['2321 Compliance Project'], presentation: 'mobile_capture',
  });
  return { React, rtl, draft, notes };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => mockPhone.clear());

async function writeNote(ownerKey: string, text = NOTE) {
  const app = launch();
  const screen = app.rtl.render(app.notes(ownerKey));
  await app.rtl.act(settle);
  app.rtl.fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
  await app.rtl.act(async () => {
    app.rtl.fireEvent.changeText(screen.getByLabelText('Field note'), text);
    await settle();
  });
  return { app, screen };
}

async function reopen(ownerKey: string) {
  const app = launch();
  const screen = app.rtl.render(app.notes(ownerKey));
  await app.rtl.act(async () => { await settle(); await settle(); });
  return { app, screen };
}

describe('field note kept until Save (A11 pass 4 L3)', () => {
  it('a note not yet saved is back after the app is closed, for the same account only', async () => {
    const first = await writeNote('owner-a');
    first.screen.unmount(); // iOS closes the app

    const other = await reopen('owner-b');
    expect(other.screen.queryByDisplayValue(NOTE)).toBeNull();
    expect(other.screen.queryByText(KEPT_NOTICE)).toBeNull();
    other.screen.unmount();

    const again = await reopen('owner-a');
    expect(again.screen.getByLabelText('Field note').props.value).toBe(NOTE);
    expect(again.screen.getByText(KEPT_NOTICE)).toBeTruthy();
    again.screen.unmount();
  });

  it('Save clears the kept note', async () => {
    const { app, screen } = await writeNote('owner-save');
    await app.rtl.act(async () => {
      app.rtl.fireEvent.press(screen.getByRole('button', { name: 'Save Field Note' }));
      await settle();
      await settle();
    });
    expect(screen.getByText('Field note saved on this device. Vitruvius will send it to the desktop automatically.')).toBeTruthy();
    screen.unmount();
    expect(keptKeys()).toEqual([]);

    const again = await reopen('owner-save');
    expect(again.screen.queryByLabelText('Field note')).toBeNull();
    again.screen.unmount();
  });

  it('clearing the words clears the kept note', async () => {
    const { app, screen } = await writeNote('owner-clear');
    await app.rtl.act(async () => {
      app.rtl.fireEvent.changeText(screen.getByLabelText('Field note'), '');
      await settle();
    });
    screen.unmount();
    expect(keptKeys()).toEqual([]);
  });

  it('an account change or sign-out removes every kept note, even a write still on its way', async () => {
    const { app, screen } = await writeNote('owner-out');
    await app.rtl.act(async () => {
      app.rtl.fireEvent.changeText(screen.getByLabelText('Field note'), `${NOTE}, level 3`);
      app.draft.forgetFieldNoteDraft();
      await settle();
      await settle();
    });
    screen.unmount();
    expect(keptKeys()).toEqual([]);

    const again = await reopen('owner-out');
    expect(again.screen.queryByLabelText('Field note')).toBeNull();
    again.screen.unmount();
  });

  it('a project chosen with nothing written is not kept', async () => {
    const app = launch();
    const screen = app.rtl.render(app.notes('owner-empty'));
    await app.rtl.act(settle);
    app.rtl.fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
    await app.rtl.act(async () => {
      app.rtl.fireEvent.press(screen.getByRole('radio', { name: '2321 Compliance Project' }));
      await settle();
    });
    screen.unmount();
    expect(keptKeys()).toEqual([]);
  });
});

describe('Project Walk memory kept until Save (A11 pass 4 L3)', () => {
  const memory = (id: string) => {
    const { createCaptureMemory } = require('../../services/DAVECaptureMemory');
    return createCaptureMemory({
      id,
      transcript: 'Drywall crew finishes Friday.',
      transcriptSourceRecordId: `voice-transcription:${id}`,
      createdAt: '2026-09-30T12:00:00.000Z',
      recommendedProject: { value: 'Canopy B', confidence: 'high', confirmed: true },
      fields: { generalMemory: 'Drywall crew finishes Friday.' },
    });
  };

  function walk(owner: string, projectName: string) {
    jest.resetModules();
    const React = require('react');
    const rtl = require('@testing-library/react-native/pure');
    const { NativeWorkspaceOwnerContext } = require('../../components/native-workspace-owner');
    const kept = require('../../hooks/use-kept-walk-memory-draft');
    const wrapper = ({ children }: { children: unknown }) =>
      React.createElement(NativeWorkspaceOwnerContext.Provider, { value: owner }, children);
    const hook = rtl.renderHook(() => kept.useKeptWalkMemoryDraft(projectName), { wrapper });
    return { rtl, kept, hook };
  }

  it('an unconfirmed memory is back after the app is closed, for the same account and project only', async () => {
    const first = walk('owner-a', 'Canopy B');
    await first.rtl.act(async () => { first.hook.result.current[1](memory('memory-l3')); await settle(); });
    first.hook.unmount();

    for (const [owner, project] of [['owner-b', 'Canopy B'], ['owner-a', 'Pier 7']]) {
      const other = walk(owner, project);
      await other.rtl.act(async () => { await settle(); await settle(); });
      expect(other.hook.result.current[0]).toBeNull();
      other.hook.unmount();
    }

    const again = walk('owner-a', 'Canopy B');
    await again.rtl.act(async () => { await settle(); await settle(); });
    expect(again.hook.result.current[0]).toMatchObject({
      id: 'memory-l3', status: 'draft', transcript: 'Drywall crew finishes Friday.', confirmedAt: null,
    });
    again.hook.unmount();
  });

  it('Save or Cancel clears it; an account change or sign-out removes it, on screen too', async () => {
    const first = walk('owner-a', 'Canopy B');
    await first.rtl.act(async () => { first.hook.result.current[1](memory('memory-cancel')); await settle(); });
    await first.rtl.act(async () => { first.hook.result.current[1](null); await settle(); });
    expect(keptKeys()).toEqual([]);

    await first.rtl.act(async () => { first.hook.result.current[1](memory('memory-out')); await settle(); });
    expect(keptKeys()).toHaveLength(1);
    await first.rtl.act(async () => { first.kept.forgetKeptWalkMemoryDrafts(); await settle(); await settle(); });
    expect(first.hook.result.current[0]).toBeNull();
    expect(keptKeys()).toEqual([]);
    first.hook.unmount();
  });

  it('unreadable kept data is ignored, not shown', async () => {
    const first = walk('owner-a', 'Canopy B');
    await first.rtl.act(async () => { first.hook.result.current[1](memory('memory-bad')); await settle(); });
    first.hook.unmount();
    const [key] = keptKeys();
    mockPhone.set(key, JSON.stringify({ version: 1, keptAt: 'x', value: { id: 'memory-bad' } }));
    const again = walk('owner-a', 'Canopy B');
    await again.rtl.act(async () => { await settle(); await settle(); });
    expect(again.hook.result.current[0]).toBeNull();
    again.hook.unmount();
  });

  it('App keeps the Project Walk memory with this hook and forgets it with the field note', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toMatch(/const \[captureDraft, setCaptureDraft\] = useKeptWalkMemoryDraft\(projectName\);/);
    expect(app).not.toContain('const [captureDraft, setCaptureDraft] = useState');
    // Everyday item 4 (2 Oct 2026): a recording kept on the device for signal is forgotten with them;
    // pin updated deliberately (behaviour in everyday-4-voice-kept-recording).
    expect(app).toMatch(/if \(accountChanged\) \{ forgetFieldNoteDraft\(\); forgetKeptWalkMemoryDrafts\(\); forgetKeptVoiceRecordings\(\); \}/);
  });
});
