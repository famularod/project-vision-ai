/**
 * Review of D1 (independent review P5, pass 1), L7, on the real web gateway.
 * The reviewer's rig, brought in as he wrote it, with two cases added.
 *
 * Archive and Restore are the first writes to a shared document that do NOT
 * write its record (document_data): they write archived_at alone. The
 * cloud's live changes leave an unchanged large column out of the row they
 * send (the database does not log a big value an update did not touch, and
 * the live-change service sends what was logged). So for a document whose
 * record is large the live row of an Archive or a Restore has no
 * document_data. The phone already treats such a row as "read the list
 * again". The web put the live row in place of the row it held and then did
 * not read the list again, so the document was left with a name and a
 * category and nothing else: no project, no file, until the page was
 * reloaded.
 *
 * Now the live row is merged into the held one: the held record is kept and
 * the live row's own columns (the mark among them) are taken. Where the held
 * row cannot be trusted to complete it (the page holds no such row, or its
 * "last changed" stamp differs), the list is read again.
 *
 * Whether the cloud sends such a row for a given document depends on that
 * record's size and could not be run here.
 */
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

const LOT_9 = '11111111-1111-4111-8111-111111111111';
const permitRow = {
  id: 'doc-permit', owner_id: 'owner-1', name: 'Grading permit', category: 'Permit Card', updated_at: '2026-10-05T16:00:00.000Z',
  document_data: {
    id: 'doc-permit', name: 'Grading permit', originalFileName: 'Grading permit.pdf', category: 'Permit Card', notes: '', isCurrent: false,
    importedAt: '2026-10-05T15:59:00.000Z', projectId: LOT_9, projectName: 'Lot 9', projectNames: ['Lot 9'],
    storagePath: 'owner-1/project-documents/doc-permit/Grading permit.pdf',
  },
};

async function webWithThePermit(marks: Array<{ id: string; archived_at: string }>) {
  const rangeQuery = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'not', 'gt', 'limit']) chain[method] = () => chain;
    chain.range = async () => ({ data: rows, error: null, status: 200, count: rows.length });
    // The question "which are archived?" is awaited as it stands.
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: marks, error: null, status: 200 }).then(resolve);
    return chain;
  };
  const rpc = jest.fn(async (name: string) => {
    if (name === 'dave_is_app_owner') return { data: true, error: null, status: 200 };
    if (name === 'dave_list_reference_document_metadata') return { data: [permitRow], error: null, status: 200 };
    return { data: null, error: null, status: 200 };
  });
  const handlers = new Map<string, (payload: unknown) => void>();
  const channel: { on: jest.Mock; subscribe: jest.Mock } = { on: jest.fn(), subscribe: jest.fn() };
  channel.on.mockImplementation((_kind: string, configuration: { table: string }, handler: (payload: unknown) => void) => {
    handlers.set(configuration.table, handler);
    return channel;
  });
  channel.subscribe.mockImplementation(() => channel);
  const client = {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
      getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
    from: jest.fn(() => rangeQuery([])),
    rpc,
    storage: { from: jest.fn() },
    channel: jest.fn(() => channel),
    removeChannel: jest.fn().mockResolvedValue('ok'),
  };
  const gateway = createDAVEWebSupabaseGateway(client as never);
  const first = await gateway.loadAuthorizedRows();
  await gateway.subscribeToAuthorizedOperationalChanges({ onChange: jest.fn() });
  return { gateway, handlers, first, rpc };
}

/** The live row of a write that set archived_at and nothing else, on a document whose record is large. */
const liveRowWithoutTheRecord = (archivedAt: string | null) => ({
  eventType: 'UPDATE',
  new: { id: 'doc-permit', owner_id: 'owner-1', name: 'Grading permit', category: 'Permit Card', updated_at: '2026-10-05T16:00:00.000Z', archived_at: archivedAt },
  old: {},
});

describe('review of D1, L7: the web, an open page, and the live row of a Restore made on the phone', () => {
  it('F-L7: the restored document still has its record on the web (its project, its file): the page lists it under Lot 9', async () => {
    const { gateway, handlers, first, rpc } = await webWithThePermit([{ id: 'doc-permit', archived_at: '2026-10-06T18:00:00.000Z' }]);
    expect((first.referenceDocuments[0] as { archived_at?: string }).archived_at).toBe('2026-10-06T18:00:00.000Z');

    handlers.get('reference_documents')?.(liveRowWithoutTheRecord(null)); // Restore, tapped on the phone
    const rows = await gateway.loadAuthorizedRows(['reference_documents']); // the page's refresh after a live change

    const held = rows.referenceDocuments.find(row => (row as { id?: string }).id === 'doc-permit') as { archived_at?: unknown; document_data?: { projectName?: string; storagePath?: string } };
    expect(held.archived_at ?? null).toBeNull(); // it is listed again...
    expect(held.document_data?.projectName).toBe('Lot 9'); // ...and is still Lot 9's, with its file
    expect(held.document_data?.storagePath).toBe('owner-1/project-documents/doc-permit/Grading permit.pdf');
    // The live row was enough: the list was not read from the cloud a second time.
    expect(rpc.mock.calls.filter(([name]) => name === 'dave_list_reference_document_metadata')).toHaveLength(1);
  });

  it('the live row of an Archive without the record: the page hides the document and keeps its record for when it is restored', async () => {
    const { gateway, handlers } = await webWithThePermit([]);
    handlers.get('reference_documents')?.(liveRowWithoutTheRecord('2026-10-06T18:00:00.000Z'));
    const rows = await gateway.loadAuthorizedRows(['reference_documents']);
    const held = rows.referenceDocuments[0] as { archived_at?: unknown; document_data?: { projectName?: string } };
    expect(held.archived_at).toBe('2026-10-06T18:00:00.000Z');
    expect(held.document_data?.projectName).toBe('Lot 9');
  });

  it('a live row without the record that the held row cannot complete (another "last changed" stamp, or no held row): the list is read again', async () => {
    const { gateway, handlers, rpc } = await webWithThePermit([]);
    const listReads = () => rpc.mock.calls.filter(([name]) => name === 'dave_list_reference_document_metadata').length;
    expect(listReads()).toBe(1);
    // The record was changed on another device since this page read it.
    handlers.get('reference_documents')?.({ ...liveRowWithoutTheRecord(null), new: { ...liveRowWithoutTheRecord(null).new, updated_at: '2026-10-06T19:00:00.000Z' } });
    let rows = await gateway.loadAuthorizedRows(['reference_documents']);
    expect(listReads()).toBe(2);
    expect((rows.referenceDocuments[0] as { document_data?: { projectName?: string } }).document_data?.projectName).toBe('Lot 9');
    // A document this page does not hold.
    handlers.get('reference_documents')?.({ ...liveRowWithoutTheRecord(null), new: { ...liveRowWithoutTheRecord(null).new, id: 'doc-unknown' } });
    rows = await gateway.loadAuthorizedRows(['reference_documents']);
    expect(listReads()).toBe(3);
    expect(rows.referenceDocuments.map(row => (row as { id?: string }).id)).toEqual(['doc-permit']);
  });

  it('sound: when the live row does carry the record (a small one), the web follows the Restore and keeps the record', async () => {
    const { gateway, handlers } = await webWithThePermit([{ id: 'doc-permit', archived_at: '2026-10-06T18:00:00.000Z' }]);
    handlers.get('reference_documents')?.({ eventType: 'UPDATE', new: { ...permitRow, archived_at: null }, old: {} });
    const rows = await gateway.loadAuthorizedRows(['reference_documents']);
    const held = rows.referenceDocuments[0] as { archived_at?: unknown; document_data?: { projectName?: string } };
    expect(held.archived_at ?? null).toBeNull();
    expect(held.document_data?.projectName).toBe('Lot 9');
  });

  it('sound: the live row of an Archive hides the document on the open page without a read', async () => {
    const { gateway, handlers } = await webWithThePermit([]);
    handlers.get('reference_documents')?.({ eventType: 'UPDATE', new: { ...permitRow, archived_at: '2026-10-06T18:00:00.000Z' }, old: {} });
    const rows = await gateway.loadAuthorizedRows(['reference_documents']);
    expect((rows.referenceDocuments[0] as { archived_at?: string }).archived_at).toBe('2026-10-06T18:00:00.000Z');
  });
});
