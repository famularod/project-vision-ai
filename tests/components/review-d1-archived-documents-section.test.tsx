/**
 * Review of D1 (independent review P5, pass 1), L2: a Restore this device let
 * go without sending it (the document was archived again on another device
 * afterwards) is said in a line under the project's Documents header, which
 * stays until the owner taps OK. The real section and the real service,
 * against a stand-in for the cloud's table.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { ArchivedDocumentsSection } from '../../components/archived-documents-section';
import type { MobileArchivedDocument } from '../../services/MobileDocumentWorkspace';
import {
  openSharedDocumentArchive,
  requestSharedDocumentArchive,
  sharedDocumentArchiveSettled,
  sharedDocumentArchiveView,
  syncSharedDocumentArchiveWithCloud,
} from '../../services/SharedDocumentArchive';
import { createSharedDocumentCloud, type SharedDocumentCloud } from '../fixtures/shared-document-cloud';

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  },
}));

const PERMIT = 'doc-permit';
const OWNER = 'owner-a';
const logged: string[] = [];
const originalError = console.error;
beforeAll(() => { console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); }; });
afterAll(() => {
  console.error = originalError;
  const phrases = ['not wrapped in act(', 'Cannot log after tests are done', 'torn down', 'unhandled promise rejection'];
  expect(logged.filter(line => phrases.some(phrase => line.toLowerCase().includes(phrase.toLowerCase())))).toEqual([]);
});

let cloud: SharedDocumentCloud;
const reach = () => syncSharedDocumentArchiveWithCloud({ client: cloud.client, ownerId: OWNER, timeoutMs: 200 });
const archivedCard: MobileArchivedDocument = {
  key: `reference:${PERMIT}`, name: 'Grading permit', category: 'Permit Card', cardId: null, sharedDocumentId: PERMIT, scope: 'everywhere',
};

beforeEach(async () => {
  mockStorage.clear();
  cloud = createSharedDocumentCloud({ installed: true });
  cloud.state.signedInOwnerId = OWNER;
  cloud.add(PERMIT, OWNER);
  cloud.paste();
  await openSharedDocumentArchive(OWNER);
});

/** An iPad that restored with no signal, and a phone that archived the document again after that. */
async function aRestoreLetGo(name?: string) {
  cloud.row(PERMIT)!.archived_at = '2026-10-06T09:00:00.000Z';
  await reach();
  cloud.state.offline = true;
  await requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:10:00.000Z', name);
  await reach();
  cloud.row(PERMIT)!.archived_at = '2026-10-06T09:30:00.000Z'; // restored and archived again on the phone
  cloud.state.offline = false;
  await reach();
  await sharedDocumentArchiveSettled();
}

describe('review of D1, L2: the line for a Restore that was not sent', () => {
  it('is shown above "Archived (1)" with what happened and the document\'s state, and goes when he taps OK', async () => {
    await aRestoreLetGo('Grading permit');
    expect(sharedDocumentArchiveView().notices).toHaveLength(1);
    const onRestore = jest.fn();
    const tree = render(<ArchivedDocumentsSection documents={[archivedCard]} onRestore={onRestore} />);
    expect(tree.getByText('Grading permit: your Restore on this device was not sent. It was archived again on another device after you tapped Restore here, so it stays archived.')).toBeTruthy();
    expect(tree.getByText('Archived (1)')).toBeTruthy();

    await act(async () => {
      fireEvent.press(tree.getByLabelText('OK, dismiss the note about Grading permit'));
      await sharedDocumentArchiveSettled();
    });
    expect(tree.queryByTestId('archived-document-notice')).toBeNull();
    expect(tree.getByText('Archived (1)')).toBeTruthy();
    expect(sharedDocumentArchiveView().notices).toEqual([]);
    expect(onRestore).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('takes the name from the archived list when the tap did not carry one, and is shown even where the project lists nothing archived', async () => {
    await aRestoreLetGo();
    const named = render(<ArchivedDocumentsSection documents={[archivedCard]} onRestore={jest.fn()} />);
    expect(named.getByText(/^Grading permit: your Restore on this device was not sent\./)).toBeTruthy();
    named.unmount();
    const otherProject = render(<ArchivedDocumentsSection documents={[]} onRestore={jest.fn()} />);
    expect(otherProject.getByText(/^A document: your Restore on this device was not sent\./)).toBeTruthy();
    expect(otherProject.queryByText(/^Archived \(/)).toBeNull();
    otherProject.unmount();
  });

  it('with nothing archived and nothing to say, nothing is shown', () => {
    const tree = render(<ArchivedDocumentsSection documents={[]} onRestore={jest.fn()} />);
    expect(tree.queryByTestId('archived-documents-section')).toBeNull();
    tree.unmount();
  });
});
