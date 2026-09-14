import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FieldNotesWorkspace } from '../../components/field-notes-workspace';
import { createFieldNoteRepository, markFieldNoteSynced, type FieldNote } from '../../services/FieldNoteRepository';
import { createMobileFieldNoteDataSource } from '../../services/FieldNoteMobileSync';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

test('save confirmation and reopened inbox do not wait for an unavailable cloud', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
  };
  const never = () => new Promise<readonly FieldNote[]>(() => undefined);
  const cloud = {
    list: jest.fn(never),
    create: jest.fn((_note: FieldNote) => new Promise<FieldNote>(() => undefined)),
    update: jest.fn((_note: FieldNote) => new Promise<FieldNote>(() => undefined)),
    subscribe: async () => () => undefined,
  };
  const source = createMobileFieldNoteDataSource({ localRepository: createFieldNoteRepository(storage), cloudGateway: cloud });
  const first = render(<FieldNotesWorkspace ownerKey="owner" projects={[]} dataSource={source} presentation="mobile_capture" />);
  await waitFor(() => expect(first.getByText('No open field notes.')).toBeTruthy());
  fireEvent.press(first.getByRole('button', { name: 'Type field note' }));
  fireEvent.changeText(first.getByLabelText('Field note'), 'Offline disposable regression note');
  fireEvent.press(first.getByRole('button', { name: 'Save Field Note' }));
  await waitFor(() => expect(first.getByText('Field note saved on this device. Vitruvius will send it to the desktop automatically.')).toBeTruthy());
  const saved = (await createFieldNoteRepository(storage).list('owner'))[0];
  expect(saved.originalText).toBe('Offline disposable regression note');
  expect(saved.syncState).toBe('pending');
  first.unmount();

  // New repository and datasource simulate JS restart. The same durable store survives.
  const restarted = createMobileFieldNoteDataSource({ localRepository: createFieldNoteRepository(storage), cloudGateway: cloud });
  const second = render(<FieldNotesWorkspace ownerKey="owner" projects={[]} dataSource={restarted} presentation="mobile_capture" />);
  await waitFor(() => expect(second.getByText(saved.originalText)).toBeTruthy());
  expect(second.getByText('Waiting to sync')).toBeTruthy();
  second.unmount();

  // Reconnect with a new live transport, acknowledging the original stable ID.
  const recoveredCloud = { ...cloud, list: async () => [], create: jest.fn(async (note: FieldNote) => markFieldNoteSynced(note, 1, new Date().toISOString())) };
  const reconnected = createMobileFieldNoteDataSource({ localRepository: createFieldNoteRepository(storage), cloudGateway: recoveredCloud });
  const third = render(<FieldNotesWorkspace ownerKey="owner" projects={[]} dataSource={reconnected} presentation="mobile_capture" />);
  await waitFor(() => expect(third.getByText('Sent to desktop')).toBeTruthy());
  expect(recoveredCloud.create).toHaveBeenCalledTimes(1);
  expect((await createFieldNoteRepository(storage).list('owner')).map(note => note.id)).toEqual([saved.id]);
  expect(await createFieldNoteRepository(storage).list('another-owner')).toEqual([]);
  await act(async () => third.unmount());
});
