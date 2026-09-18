import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeRoot } from '../../entry';
import { createFieldNote, createFieldNoteRepository, markFieldNoteSynced, type FieldNote } from '../../services/FieldNoteRepository';
import { createMobileFieldNoteDataSource, mobileFieldNoteDataSource } from '../../services/FieldNoteMobileSync';
import { getCurrentSessionUser, subscribeToAuthStateChange } from '../../services/SupabaseService';

jest.mock('expo', () => ({ registerRootComponent: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
    getAllKeys: async () => [...values.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, values.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => { entries.forEach(([key, value]) => values.set(key, value)); },
    multiRemove: async (keys: string[]) => { keys.forEach(key => values.delete(key)); },
    clear: async () => values.clear(),
  };
});
jest.mock('../../services/SupabaseService', () => ({
  getCurrentSessionUser: jest.fn(),
  subscribeToAuthStateChange: jest.fn(() => () => undefined),
  getSupabaseClient: jest.fn(() => null),
}));
jest.mock('../../services/FieldNoteMobileSync', () => ({
  ...jest.requireActual('../../services/FieldNoteMobileSync'),
  mobileFieldNoteDataSource: {},
}));
jest.mock('../../components/pending-changes-retry-boundary', () => ({
  PendingChangesRetryBoundary: ({ children }: { children: unknown }) => children,
}));
jest.mock('../../components/DAVEVoiceCaptureSheet', () => ({ DAVEVoiceCaptureSheet: () => null }));
// Replace only the large navigation shell. Real NativeRoot, owner sandbox,
// NativeFieldNotesExperience, inbox, repository and sync coordinator execute.
// No owner prop or online Layer4 identity is supplied to the notes screen.
jest.mock('../../App', () => {
  const React = require('react');
  const { NativeFieldNotesExperience } = require('../../components/native-field-notes-experience');
  return { __esModule: true, default: () => React.createElement(NativeFieldNotesExperience, {
    contentStyle: undefined, projects: [], projectRecords: [], projectAreas: [],
  }) };
});

const session = jest.mocked(getCurrentSessionUser);
const subscribe = jest.mocked(subscribeToAuthStateChange);
const repository = () => createFieldNoteRepository(AsyncStorage);
const hangingCloud = () => ({
  list: jest.fn(() => new Promise<readonly FieldNote[]>(() => undefined)),
  create: jest.fn((_note: FieldNote) => new Promise<FieldNote>(() => undefined)),
  update: jest.fn((_note: FieldNote) => new Promise<FieldNote>(() => undefined)),
  subscribe: async () => () => undefined,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  session.mockResolvedValue({ ok: true, data: { id: 'owner-a' } } as Awaited<ReturnType<typeof getCurrentSessionUser>>);
  Object.assign(mobileFieldNoteDataSource, createMobileFieldNoteDataSource({
    localRepository: repository(), cloudGateway: hangingCloud(),
  }));
});

// First render loads the whole native root; allow for a busy machine. Assertions are unchanged.
const COLD_RENDER = { timeout: 15_000 } as const;
jest.setTimeout(60_000);

test('local session owner restores the saved note through three offline native-root reopen cycles', async () => {
  const first = render(<NativeRoot />);
  await waitFor(() => expect(first.getByText('No open field notes.')).toBeTruthy(), COLD_RENDER);
  fireEvent.press(first.getByRole('button', { name: 'Type field note' }));
  fireEvent.changeText(first.getByLabelText('Field note'), 'Offline native startup note');
  fireEvent.press(first.getByRole('button', { name: 'Save Field Note' }));
  await waitFor(() => expect(first.getByText('Field note saved on this device. Vitruvius will send it to the desktop automatically.')).toBeTruthy());
  const saved = (await repository().list('owner-a'))[0];
  expect(saved.originalText).toBe('Offline native startup note');
  expect(await repository().list('local-device')).toEqual([]);
  first.unmount();

  for (let cycle = 0; cycle < 3; cycle += 1) {
    Object.assign(mobileFieldNoteDataSource, createMobileFieldNoteDataSource({
      localRepository: repository(), cloudGateway: hangingCloud(),
    }));
    const reopened = render(<NativeRoot />);
    await waitFor(() => expect(reopened.getByText(saved.originalText)).toBeTruthy());
    expect(reopened.getByText('Waiting to sync')).toBeTruthy();
    expect((await repository().list('owner-a')).map(note => note.id)).toEqual([saved.id]);
    reopened.unmount();
  }

  const cloud = {
    ...hangingCloud(), list: async () => [],
    create: jest.fn(async (note: FieldNote) => markFieldNoteSynced(note, 1, new Date().toISOString())),
  };
  Object.assign(mobileFieldNoteDataSource, createMobileFieldNoteDataSource({ localRepository: repository(), cloudGateway: cloud }));
  const connected = render(<NativeRoot />);
  await waitFor(() => expect(connected.getByText('Sent to desktop')).toBeTruthy());
  expect(cloud.create).toHaveBeenCalledTimes(1);
  expect((await repository().list('owner-a')).map(note => note.id)).toEqual([saved.id]);
});

test('account switch and sign-out never reuse the previous owner inbox or typed draft', async () => {
  await repository().save('owner-a', createFieldNote({ id: 'note-a', text: 'Owner A private note' }));
  await repository().save('owner-b', createFieldNote({ id: 'note-b', text: 'Owner B private note' }));
  const screen = render(<NativeRoot />);
  await waitFor(() => expect(screen.getByText('Owner A private note')).toBeTruthy(), COLD_RENDER);
  fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
  fireEvent.changeText(screen.getByLabelText('Field note'), 'Owner A unsaved draft');
  const listener = subscribe.mock.calls[subscribe.mock.calls.length - 1][0];
  await act(async () => listener('SIGNED_IN', { user: { id: 'owner-b' } } as never));
  await waitFor(() => expect(screen.getByText('Owner B private note')).toBeTruthy());
  expect(screen.queryByText('Owner A private note')).toBeNull();
  expect(screen.queryByDisplayValue('Owner A unsaved draft')).toBeNull();
  await act(async () => listener('SIGNED_OUT', null));
  await waitFor(() => expect(screen.getByText('No open field notes.')).toBeTruthy());
  expect(screen.queryByText('Owner B private note')).toBeNull();
  expect((await repository().list('owner-a'))[0].id).toBe('note-a');
});

test('unresolved session never mounts a guessed owner inbox', async () => {
  session.mockReturnValue(new Promise(() => undefined));
  const screen = render(<NativeRoot />);
  expect(screen.getByText('Opening your Vitruvius workspace…')).toBeTruthy();
  expect(screen.queryByText('Field Notes')).toBeNull();
});
