/**
 * Owner answer Q44 (6 Oct 2026), on the web: a compliance document archived
 * on the phone is hidden on every device and kept in the cloud, so the web's
 * Documents list leaves it out. The real web gateway and the real snapshot,
 * against a stand-in for the cloud: before the owner's database change (no
 * such column: every document is listed, as before, and nothing fails),
 * after it, and when the cloud does not answer.
 *
 * As in the cloud, the document list itself does not carry the mark: the
 * marks are kept beside the stand-in's rows here, and answered only to the
 * question the web asks of the table.
 */
import { createFakeWebCloud, type FakeWebCloud } from '../fixtures/fake-web-cloud';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  ...jest.requireActual('../../services/DAVEWebSupabaseClient'),
  // The snapshot reads through the app's one gateway; each test points it at its own.
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

import { daveWebListedDocuments, groupDAVEWebDocuments } from '../../services/DAVEWebDocumentManagement';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { createDAVEWebSupabaseGateway, daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

const LOT_9 = '11111111-1111-4111-8111-111111111111';
const AT = '2026-10-06T18:00:00.000Z';
const documentRow = (id: string, category: string) => ({
  id, owner_id: 'owner-1', name: id, category, updated_at: '2026-10-05T16:00:00.000Z',
  document_data: {
    id, name: id, originalFileName: `${id}.pdf`, category, notes: '', isCurrent: false,
    importedAt: '2026-10-05T15:59:00.000Z', projectId: LOT_9, projectName: 'Lot 9', projectNames: ['Lot 9'],
  },
});

type MarkState = { column: 'missing' | 'there'; answers: boolean; marks: Map<string, string>; asked: number };

/** The stand-in cloud, plus the table's answer to "which of my documents are archived?". */
function webCloud() {
  const cloud: FakeWebCloud = createFakeWebCloud();
  cloud.insert('projects', { id: LOT_9, owner_id: 'owner-1', name: 'Lot 9', archived: false, created_at: '2026-09-01T00:00:00.000Z' });
  cloud.insert('reference_documents', documentRow('Grading permit', 'Permit Card'));
  cloud.insert('reference_documents', documentRow('Site contract', 'Contract'));
  const state: MarkState = { column: 'missing', answers: true, marks: new Map(), asked: 0 };
  const client = {
    ...cloud.client,
    from(table: string) {
      const chain = cloud.client.from(table) as Record<string, (...args: unknown[]) => unknown>;
      if (table !== 'reference_documents') return chain;
      return {
        ...chain,
        select(columns?: unknown, ...rest: unknown[]) {
          if (columns !== 'id, archived_at') return chain.select(columns, ...rest);
          const marksQuery: Record<string, unknown> = {
            eq: () => marksQuery,
            not: () => marksQuery,
            then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
              state.asked += 1;
              const answer = !state.answers
                ? Promise.reject(new TypeError('Failed to fetch'))
                : Promise.resolve(state.column === 'missing'
                  ? { data: null, error: { code: '42703', message: 'column reference_documents.archived_at does not exist' }, status: 400 }
                  : { data: [...state.marks].map(([id, archived_at]) => ({ id, archived_at })), error: null, status: 200 });
              return answer.then(resolve, reject);
            },
          };
          return marksQuery;
        },
      };
    },
  };
  const gateway = createDAVEWebSupabaseGateway(client as never);
  jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockImplementation(collections => gateway.loadAuthorizedRows(collections));
  return { cloud, state, gateway };
}

/** What the web's Documents list shows, as the page builds it from the snapshot. */
async function documentsListed() {
  const snapshot = await loadDAVEWebReadOnlySnapshot();
  const listed = daveWebListedDocuments(snapshot.referenceDocuments, snapshot.archivedDocumentIds);
  return { snapshot, names: groupDAVEWebDocuments(listed).otherDocuments.map(document => document.name).sort() };
}

describe('the web\'s Documents list and the archived mark (owner answer Q44)', () => {
  it('before the database change: the cloud says "no such column", every document is listed and nothing fails', async () => {
    const { state } = webCloud();
    const { snapshot, names } = await documentsListed();
    expect(state.asked).toBe(1);
    expect(names).toEqual(['Grading permit', 'Site contract']);
    expect(snapshot.archivedDocumentIds).toEqual([]);
  });

  it('after it: a document the phone archived is not listed and not counted; the others are', async () => {
    const { state } = webCloud();
    state.column = 'there';
    state.marks.set('Grading permit', AT);
    const { snapshot, names } = await documentsListed();
    expect(names).toEqual(['Site contract']);
    expect(snapshot.archivedDocumentIds).toEqual(['Grading permit']);
    expect(daveWebListedDocuments(snapshot.referenceDocuments, snapshot.archivedDocumentIds)).toHaveLength(1);
    // It is hidden, not gone: the snapshot still holds the document, and the document carries no mark of its
    // own, so nothing the web saves can write one into the record.
    const kept = snapshot.referenceDocuments.find(document => document.id === 'Grading permit');
    expect(kept).toBeTruthy();
    expect(Object.keys(kept!).filter(key => /archiv/i.test(key))).toEqual([]);
  });

  it('restored on the phone or the iPad: listed again at the next read', async () => {
    const { state } = webCloud();
    state.column = 'there';
    state.marks.set('Grading permit', AT);
    expect((await documentsListed()).names).toEqual(['Site contract']);
    state.marks.delete('Grading permit');
    expect((await documentsListed()).names).toEqual(['Grading permit', 'Site contract']);
  });

  it('the cloud not answering that one question fails nothing: the tab keeps the marks it last read', async () => {
    const { state } = webCloud();
    state.column = 'there';
    state.marks.set('Grading permit', AT);
    expect((await documentsListed()).names).toEqual(['Site contract']);
    state.answers = false;
    const again = await documentsListed();
    expect(again.names).toEqual(['Site contract']);
    expect(again.snapshot.archivedDocumentIds).toEqual(['Grading permit']);
  });

  it('a tab that has never had an answer lists the document (as before) rather than fail to open', async () => {
    const { state } = webCloud();
    state.column = 'there';
    state.marks.set('Grading permit', AT);
    state.answers = false;
    expect((await documentsListed()).names).toEqual(['Grading permit', 'Site contract']);
  });

  it('a live change from the cloud carries the mark on its row: such a row is read as archived', async () => {
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
      projects: [{ id: LOT_9, name: 'Lot 9', archived: false }],
      scheduleItems: [], projectUpdates: [], syncTombstones: [],
      referenceDocuments: [{ ...documentRow('Grading permit', 'Permit Card'), archived_at: AT }, { ...documentRow('Site contract', 'Contract'), archived_at: null }],
    } as never);
    const { snapshot, names } = await documentsListed();
    expect(snapshot.archivedDocumentIds).toEqual(['Grading permit']);
    expect(names).toEqual(['Site contract']);
  });

  it('the rule itself: with no archived ids the very same list comes back', () => {
    const documents = [{ id: 'a' }, { id: 'b' }];
    expect(daveWebListedDocuments(documents, [])).toBe(documents);
    expect(daveWebListedDocuments(documents, undefined)).toBe(documents);
    expect(daveWebListedDocuments(documents, ['b'])).toEqual([{ id: 'a' }]);
  });
});
