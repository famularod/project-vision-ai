import { createDAVEOperationalRealtimeApplier, mergeProjectNames } from '../../services/DAVEOperationalRealtimeApplication';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { carryECOSHostedIndexStatus } from '../../services/ECOSHostedIndexer';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

// Whole-app audit round 2 F3 (30 Sep 2026): a live (Realtime) document row
// carries the stored copy of the preparation status, which is missing or
// older than the status the last refresh read from the hosted indexer. The
// echo of Make Current (which only flips isCurrent) turned "Prepared — not
// current" back into "Preparing for ECOS" until the next full refresh, on
// the web and on the phone.

const PREPARED_AT = '2026-09-30T13:00:00.000Z';

const preparedStatus = {
  ecosHostedIndexStatus: 'Prepared',
  ecosHostedIndexProgressPercent: 100,
  ecosHostedIndexCustomerMessage: 'Prepared for ECOS.',
  ecosHostedIndexLimitationCount: 0,
  ecosHostedIndexSupportReference: 'support-1',
  ecosHostedIndexEvidenceVersion: 'evidence-3',
  ecosHostedIndexUpdatedAt: PREPARED_AT,
};

const heldDrawing = {
  id: 'drawing-1',
  name: 'C1 Site Plan',
  originalFileName: 'C1.pdf',
  category: 'Drawings',
  uri: '',
  notes: '',
  isCurrent: false,
  importedAt: '2026-09-30T12:00:00.000Z',
  updatedAt: '2026-09-30T12:00:00.000Z',
  contentSha256: 'sha-a',
  webFileFingerprint: 'fingerprint-a',
  storagePath: 'owner-1/documents/drawing-1.pdf',
  cloudUpdatedAt: '2026-09-30T12:00:01.000Z',
  ...preparedStatus,
};

/** The Make Current echo: the stored copy, with no preparation status. */
function makeCurrentEcho(overrides: Record<string, unknown> = {}) {
  const {
    ecosHostedIndexStatus: _status,
    ecosHostedIndexProgressPercent: _progress,
    ecosHostedIndexCustomerMessage: _message,
    ecosHostedIndexLimitationCount: _limitations,
    ecosHostedIndexSupportReference: _support,
    ecosHostedIndexEvidenceVersion: _evidence,
    ecosHostedIndexUpdatedAt: _updatedAt,
    cloudUpdatedAt: _cloudUpdatedAt,
    ...stored
  } = heldDrawing;
  return {
    ...stored,
    isCurrent: true,
    updatedAt: '2026-09-30T13:05:00.000Z',
    ...overrides,
  };
}

describe('carryECOSHostedIndexStatus (audit round 2 F3)', () => {
  test('keeps the held status when the live row has none and the file is unchanged', () => {
    expect(carryECOSHostedIndexStatus(makeCurrentEcho(), heldDrawing)).toMatchObject({
      isCurrent: true,
      ...preparedStatus,
    });
  });

  test('keeps the held status when the live row’s copy is older', () => {
    const echo = makeCurrentEcho({
      ecosHostedIndexStatus: 'Preparing',
      ecosHostedIndexProgressPercent: 40,
      ecosHostedIndexUpdatedAt: '2026-09-30T12:30:00.000Z',
    });
    expect(carryECOSHostedIndexStatus(echo, heldDrawing)).toMatchObject(preparedStatus);
  });

  test('takes the live row’s status when it is the newer one', () => {
    const echo = makeCurrentEcho({
      ecosHostedIndexStatus: 'Needs Review',
      ecosHostedIndexUpdatedAt: '2026-09-30T13:30:00.000Z',
    });
    expect(carryECOSHostedIndexStatus(echo, heldDrawing)).toBe(echo);
  });

  test.each([
    ['contentSha256', 'sha-b'],
    ['webFileFingerprint', 'fingerprint-b'],
    ['storagePath', 'owner-1/documents/drawing-1-v2.pdf'],
  ])('a replaced file (%s changed) never inherits the held status', (field, value) => {
    const echo = makeCurrentEcho({ [field]: value });
    const result = carryECOSHostedIndexStatus(echo, heldDrawing);
    expect(result).toBe(echo);
    expect(result).not.toHaveProperty('ecosHostedIndexStatus');
  });
});

describe('phone Realtime document rows keep the held preparation status (audit round 2 F3)', () => {
  function applier(documents: unknown[]) {
    const state = {
      projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [],
      updates: [], deletedUpdates: [], tombstones: [], areas: [], scheduleItems: [], documents,
    };
    const commitDocuments = jest.fn();
    const apply = createDAVEOperationalRealtimeApplier({
      isActive: () => true,
      snapshot: () => state,
      getPendingQueue: jest.fn(async () => []),
      normalizeUpdate: (value: unknown) => value,
      normalizeAreas: (value: unknown) => value,
      normalizeSchedule: (value: unknown) => value,
      normalizeDocuments: (value: unknown) => value,
      migrateSchedule: (value: unknown) => value,
      localPhotoUri: () => '',
      mergeProjectNames,
      mergeUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates,
      buildUpdateTombstone: jest.fn(),
      buildCloudDeletionBarrier: jest.fn(),
      upsertDeletedUpdate: (current: unknown[], next: unknown) => [...current, next],
      commitProjects: jest.fn(),
      commitDeletedProjects: jest.fn(),
      commitUpdates: jest.fn(),
      commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(),
      commitAreas: jest.fn(),
      commitSchedule: jest.fn(),
      commitDocuments,
    } as never);
    return { apply, commitDocuments };
  }

  function echoRow(documentData: Record<string, unknown>) {
    return {
      eventType: 'UPDATE' as const,
      newRow: {
        id: 'drawing-1',
        name: 'C1 Site Plan',
        category: 'Drawings',
        document_data: documentData,
        updated_at: '2026-09-30T13:05:01.000Z',
      },
      oldRow: null,
      raw: null,
    };
  }

  test('the Make Current echo of a drawing keeps "Prepared" on the phone', async () => {
    const { apply, commitDocuments } = applier([heldDrawing]);

    await expect(apply('reference_document', echoRow(makeCurrentEcho()))).resolves.toBe(true);

    expect(commitDocuments).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'drawing-1', isCurrent: true, ...preparedStatus }),
    ]);
  });

  test('a replaced file does not keep the old "Prepared" on the phone', async () => {
    const { apply, commitDocuments } = applier([heldDrawing]);

    await apply('reference_document', echoRow(makeCurrentEcho({ contentSha256: 'sha-b' })));

    const [[documents]] = commitDocuments.mock.calls;
    expect(documents[0]).toMatchObject({ id: 'drawing-1', contentSha256: 'sha-b' });
    expect(documents[0].ecosHostedIndexStatus).toBeUndefined();
  });
});

describe('web Realtime document rows keep the held preparation status (audit round 2 F3)', () => {
  function query(rows: unknown[]) {
    const chain: Record<string, jest.Mock> = {};
    for (const method of ['select', 'eq', 'order']) chain[method] = jest.fn(() => chain);
    chain.range = jest.fn(async () => ({ data: rows, error: null, status: 200, count: rows.length }));
    return chain;
  }

  async function gatewayWithPreparedDrawing() {
    const { ecosHostedIndexStatus: _s, ecosHostedIndexProgressPercent: _p,
      ecosHostedIndexCustomerMessage: _m, ecosHostedIndexLimitationCount: _l,
      ecosHostedIndexSupportReference: _r, ecosHostedIndexEvidenceVersion: _e,
      ecosHostedIndexUpdatedAt: _u, cloudUpdatedAt: _c, ...storedDrawing } = heldDrawing;
    const rpc = jest.fn(async (name: string) => {
      if (name === 'dave_is_app_owner') return { data: true, error: null, status: 200 };
      if (name === 'dave_list_reference_document_metadata') {
        return {
          data: [{
            id: 'drawing-1',
            name: 'C1 Site Plan',
            category: 'Drawings',
            document_data: storedDrawing,
            updated_at: '2026-09-30T12:00:01.000Z',
          }],
          error: null,
          status: 200,
        };
      }
      if (name === 'ecos_hosted_index_status_v2') {
        return {
          data: [{
            document_id: 'drawing-1',
            project_id: 'project-1',
            state: 'ready',
            customer_status: 'Prepared',
            progress_percent: 100,
            customer_message: 'Prepared for ECOS.',
            limitation_count: 0,
            support_reference: 'support-1',
            committed_evidence_version: 'evidence-3',
            updated_at: PREPARED_AT,
          }],
          error: null,
          status: 200,
        };
      }
      return { data: null, error: null, status: 200 };
    });
    const handlers = new Map<string, (payload: unknown) => void>();
    const channel: { on: jest.Mock; subscribe: jest.Mock } = { on: jest.fn(), subscribe: jest.fn() };
    channel.on.mockImplementation(
      (_kind: string, configuration: { table: string }, handler: (payload: unknown) => void) => {
        handlers.set(configuration.table, handler);
        return channel;
      },
    );
    channel.subscribe.mockImplementation(() => channel);
    const from = jest.fn(() => query([]));
    const client = {
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
        getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      },
      from,
      rpc,
      storage: { from: jest.fn() },
      channel: jest.fn(() => channel),
      removeChannel: jest.fn().mockResolvedValue('ok'),
    } as any;
    const gateway = createDAVEWebSupabaseGateway(client);
    const initial = await gateway.loadAuthorizedRows();
    expect((initial.referenceDocuments[0] as any).document_data.ecosHostedIndexStatus).toBe('Prepared');
    await gateway.subscribeToAuthorizedOperationalChanges({ onChange: jest.fn() });
    rpc.mockClear();
    return { gateway, handlers, rpc };
  }

  function echo(documentData: Record<string, unknown>) {
    return {
      eventType: 'UPDATE',
      new: {
        id: 'drawing-1',
        name: 'C1 Site Plan',
        category: 'Drawings',
        document_data: documentData,
        updated_at: '2026-09-30T13:05:01.000Z',
      },
      old: {},
    };
  }

  test('the Make Current echo keeps "Prepared", and the targeted refresh still reads nothing', async () => {
    const { gateway, handlers, rpc } = await gatewayWithPreparedDrawing();

    handlers.get('reference_documents')?.(echo(makeCurrentEcho()));
    const rows = await gateway.loadAuthorizedRows(['reference_documents']);

    expect(rpc).not.toHaveBeenCalledWith('dave_list_reference_document_metadata');
    expect((rows.referenceDocuments[0] as any).document_data).toMatchObject({
      isCurrent: true,
      ...preparedStatus,
    });
  });

  test('a live row for a replaced file does not inherit "Prepared"', async () => {
    const { gateway, handlers } = await gatewayWithPreparedDrawing();

    handlers.get('reference_documents')?.(echo(makeCurrentEcho({ storagePath: 'owner-1/documents/drawing-1-v2.pdf' })));
    const rows = await gateway.loadAuthorizedRows(['reference_documents']);

    const documentData = (rows.referenceDocuments[0] as any).document_data;
    expect(documentData.storagePath).toBe('owner-1/documents/drawing-1-v2.pdf');
    expect(documentData.ecosHostedIndexStatus).toBeUndefined();
  });
});
