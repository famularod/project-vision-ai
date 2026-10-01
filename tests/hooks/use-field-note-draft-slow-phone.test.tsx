/**
 * Whole-app audit A2 pass 5 L2 (30 Sep 2026): tapping "Type field note"
 * before slow phone storage answered erased the field note kept from before
 * iOS closed the app. The tap changed the draft, which removed the kept note
 * from the phone because nothing was written yet, and the read, overtaken by
 * that removal, answered nothing. Nothing is now written or removed on the
 * phone for an account until its first read has answered; a kept note comes
 * back when the draft on screen holds no writing, and what David has written
 * meanwhile wins and is kept. Each "launch" is a fresh module registry over
 * the same phone storage. Synthetic data only.
 */
const mockPhone = new Map<string, string>();
let mockReadGate: Promise<void> | null = null;

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: async (key: string) => {
      if (mockReadGate) await mockReadGate;
      return mockPhone.get(key) ?? null;
    },
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

const KEPT = 'Guardrail missing at the north slab edge';
const TYPED = 'Stair 2 handrail loose';
const KEPT_NOTICE = 'Your unsaved note was kept on this phone. Review it, then save.';
const keptValues = () => [...mockPhone.entries()]
  .filter(([key]) => key.startsWith('@vitruvius/kept-drafts/v1/field-note/'))
  .map(([, raw]) => (JSON.parse(raw) as { value: { text: string } }).value.text);
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
  return { rtl, draft, notes };
}

/** Phone storage that answers only when told to. */
function slowPhone() {
  let answer = () => undefined as void;
  mockReadGate = new Promise<void>(resolve => { answer = resolve; });
  return () => { mockReadGate = null; answer(); };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  mockPhone.clear();
  mockReadGate = null;
});

/** Launch one: David writes a note and iOS closes the app before Save. */
async function keepNoteFromLastLaunch(ownerKey: string) {
  const app = launch();
  const screen = app.rtl.render(app.notes(ownerKey));
  await app.rtl.act(settle);
  app.rtl.fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
  await app.rtl.act(async () => {
    app.rtl.fireEvent.changeText(screen.getByLabelText('Field note'), KEPT);
    await settle();
  });
  screen.unmount();
  expect(keptValues()).toEqual([KEPT]);
}

describe('kept field note and slow phone storage (A2 pass 5 L2)', () => {
  it('tapping Type field note before the phone answers no longer erases the kept note', async () => {
    await keepNoteFromLastLaunch('owner-a');

    const answer = slowPhone();
    const app = launch();
    const screen = app.rtl.render(app.notes('owner-a'));
    await app.rtl.act(settle);
    app.rtl.fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
    await app.rtl.act(settle);
    expect(keptValues()).toEqual([KEPT]); // still on the phone while it is slow

    await app.rtl.act(async () => { answer(); await settle(); await settle(); });
    expect(screen.getByLabelText('Field note').props.value).toBe(KEPT);
    expect(screen.getByText(KEPT_NOTICE)).toBeTruthy();
    expect(keptValues()).toEqual([KEPT]);
    screen.unmount();
  });

  it('leaving before the phone answers keeps the note for the next launch', async () => {
    await keepNoteFromLastLaunch('owner-a');

    const answer = slowPhone();
    const app = launch();
    const screen = app.rtl.render(app.notes('owner-a'));
    await app.rtl.act(settle);
    app.rtl.fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
    screen.unmount();
    await app.rtl.act(async () => { answer(); await settle(); await settle(); });
    expect(keptValues()).toEqual([KEPT]);

    const again = launch();
    const reopened = again.rtl.render(again.notes('owner-a'));
    await again.rtl.act(async () => { await settle(); await settle(); });
    expect(reopened.getByLabelText('Field note').props.value).toBe(KEPT);
    reopened.unmount();
  });

  it('words typed before the phone answers win, and are kept once it does', async () => {
    await keepNoteFromLastLaunch('owner-a');

    const answer = slowPhone();
    const app = launch();
    const screen = app.rtl.render(app.notes('owner-a'));
    await app.rtl.act(settle);
    app.rtl.fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
    await app.rtl.act(async () => {
      app.rtl.fireEvent.changeText(screen.getByLabelText('Field note'), TYPED);
      await settle();
    });
    expect(keptValues()).toEqual([KEPT]); // nothing written before it answers

    await app.rtl.act(async () => { answer(); await settle(); await settle(); });
    expect(screen.getByLabelText('Field note').props.value).toBe(TYPED);
    expect(screen.queryByText(KEPT_NOTICE)).toBeNull();
    expect(keptValues()).toEqual([TYPED]);
    screen.unmount();
  });

  it('the sign-out check still sees the kept note while the phone is slow', async () => {
    await keepNoteFromLastLaunch('owner-a');

    const answer = slowPhone();
    const app = launch();
    const screen = app.rtl.render(app.notes('owner-a'));
    await app.rtl.act(settle);
    app.rtl.fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
    let unsaved: boolean | null = null;
    await app.rtl.act(async () => {
      void app.draft.unsavedFieldNoteExists('owner-a').then((exists: boolean) => { unsaved = exists; });
      answer();
      await settle();
      await settle();
    });
    expect(unsaved).toBe(true);
    screen.unmount();
  });

  it('with nothing kept, a note typed while the phone is slow is kept once it answers', async () => {
    const answer = slowPhone();
    const app = launch();
    const screen = app.rtl.render(app.notes('owner-new'));
    await app.rtl.act(settle);
    app.rtl.fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
    await app.rtl.act(async () => {
      app.rtl.fireEvent.changeText(screen.getByLabelText('Field note'), TYPED);
      await settle();
    });
    await app.rtl.act(async () => { answer(); await settle(); await settle(); });
    expect(screen.getByLabelText('Field note').props.value).toBe(TYPED);
    expect(keptValues()).toEqual([TYPED]);
    screen.unmount();
  });
});
