/**
 * A small in-memory stand-in for the cloud's shared-document table, for the
 * archived mark (owner answer Q44, 6 Oct 2026). Nothing here reaches the
 * network.
 *
 * It models the three things those tests turn on:
 * - BEFORE the owner's database change the table has no archived_at column:
 *   asking for it, or writing it, is refused the way the cloud refuses it;
 * - a write changes only the columns it names (that is how the cloud's data
 *   API updates and upserts a row), so a write that never names the mark
 *   leaves the mark as it is;
 * - each account sees and changes only its own rows.
 */
export type SharedDocumentCloudRow = Record<string, unknown> & { id: string; owner_id: string };

type CloudError = { code: string; message: string };
type CloudResult = { data: unknown; error: CloudError | null; status: number };

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createSharedDocumentCloud({ installed = false }: { installed?: boolean } = {}) {
  const rows: SharedDocumentCloudRow[] = [];
  const state = {
    /** Whether the owner has pasted the database change. */
    installed,
    /** The account whose sign-in the device is using. */
    signedInOwnerId: 'owner-a' as string,
    /** No signal: every request fails without an answer from the cloud. */
    offline: false,
    /** Every request is held until release() (a slow connection). */
    held: [] as Array<() => void>,
    holding: false,
    /** Every write of the mark is refused with this error (a refusal that is not "no such column"). */
    refuseMarkWritesWith: null as CloudError | null,
  };
  const requests: Array<{ kind: 'read_marks' | 'write_mark' | 'write_record'; detail: unknown }> = [];

  const missingColumn = (onWrite: boolean): CloudError => onWrite
    ? { code: 'PGRST204', message: "Could not find the 'archived_at' column of 'reference_documents' in the schema cache" }
    : { code: '42703', message: 'column reference_documents.archived_at does not exist' };

  async function answer(build: () => CloudResult): Promise<CloudResult> {
    if (state.holding) await new Promise<void>(resolve => { state.held.push(resolve); });
    if (state.offline) throw new TypeError('Network request failed');
    return build();
  }

  function query(table: string) {
    const filters: Array<(row: SharedDocumentCloudRow) => boolean> = [];
    let namesMark = false;
    let patch: Record<string, unknown> | null = null;
    const visible = () => rows.filter(row => row.owner_id === state.signedInOwnerId && filters.every(filter => filter(row)));
    const run = () => answer(() => {
      if (table !== 'reference_documents') return { data: [], error: null, status: 200 };
      if (patch) {
        const writesMark = Object.prototype.hasOwnProperty.call(patch, 'archived_at');
        requests.push({ kind: writesMark ? 'write_mark' : 'write_record', detail: clone(patch) });
        if (writesMark && !state.installed) return { data: null, error: missingColumn(true), status: 400 };
        if (writesMark && state.refuseMarkWritesWith) return { data: null, error: state.refuseMarkWritesWith, status: 503 };
        const changed = visible();
        // Only the columns the write names change.
        changed.forEach(row => Object.assign(row, clone(patch)));
        return { data: changed.map(row => ({ id: row.id })), error: null, status: 200 };
      }
      requests.push({ kind: 'read_marks', detail: null });
      if (namesMark && !state.installed) return { data: null, error: missingColumn(false), status: 400 };
      return { data: visible().map(row => ({ id: row.id, archived_at: row.archived_at ?? null })), error: null, status: 200 };
    });
    const chain: Record<string, unknown> = {
      select(columns?: string) { if (String(columns || '').includes('archived_at')) namesMark = true; return chain; },
      eq(column: string, value: unknown) { filters.push(row => row[column] === value); return chain; },
      not(column: string, operator: string, value: unknown) {
        if (column === 'archived_at') namesMark = true;
        if (operator === 'is' && value === null) filters.push(row => row[column] !== null && row[column] !== undefined);
        return chain;
      },
      /** "where the column is empty": the condition on a waiting tap's write (review of D1, L2). */
      is(column: string, value: unknown) {
        if (column === 'archived_at') namesMark = true;
        if (value === null) filters.push(row => row[column] === null || row[column] === undefined);
        return chain;
      },
      order() { return chain; },
      limit() { return chain; },
      update(values: Record<string, unknown>) { patch = values; return chain; },
      then(resolve: (value: CloudResult) => unknown, reject?: (reason: unknown) => unknown) { return run().then(resolve, reject); },
    };
    return chain;
  }

  return {
    client: {
      from: (table: string) => query(table),
      // The sign-in the device holds, read on the device.
      auth: { getSession: async () => ({ data: { session: { user: { id: state.signedInOwnerId } } }, error: null }) },
    },
    state,
    rows,
    requests,
    /** A shared document as the cloud holds it, with no mark. */
    add(id: string, ownerId = 'owner-a', documentData: Record<string, unknown> = {}) {
      rows.push({ id, owner_id: ownerId, name: id, category: 'Permit Card', document_data: { id, ...documentData }, updated_at: '2026-10-05T16:00:00.000Z' });
    },
    row(id: string) { return rows.find(row => row.id === id) ?? null; },
    /** The owner pastes the database change: the column is there, empty on every row. */
    paste() {
      state.installed = true;
      rows.forEach(row => { if (!('archived_at' in row)) row.archived_at = null; });
    },
    /**
     * A device on an older build saves the record again. It names the columns
     * every build names (id, name, category, document_data, updated_at,
     * owner_id) and nothing else; the cloud changes those and no other.
     */
    olderBuildSaves(payload: Record<string, unknown> & { id: string; owner_id: string }) {
      requests.push({ kind: 'write_record', detail: clone(payload) });
      const existing = rows.find(row => row.id === payload.id && row.owner_id === payload.owner_id);
      if (existing) Object.assign(existing, clone(payload));
      else rows.push({ ...(state.installed ? { archived_at: null } : {}), ...clone(payload) });
    },
    hold() { state.holding = true; },
    release() { state.holding = false; state.held.splice(0).forEach(resolve => resolve()); },
  };
}

export type SharedDocumentCloud = ReturnType<typeof createSharedDocumentCloud>;
