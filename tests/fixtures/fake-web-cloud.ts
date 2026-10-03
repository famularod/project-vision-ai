/**
 * A small in-memory stand-in for the Supabase client the web gateway
 * (createDAVEWebSupabaseGateway) talks to: the owner check, owner-scoped
 * table reads (select/eq/order/range), the deletion-record lookup, and the
 * revision-checked task update (update/eq/select/maybeSingle). It records
 * every table read so a test can tell a real re-read from the gateway's
 * cached copy. Nothing here reaches the network.
 *
 * A10 pass 8 (30 Sep 2026): also an id-list read (in, awaited as is), the
 * deletion-record write (upsert) and the document-metadata read, so a web
 * delete runs end to end.
 */
export type FakeWebCloudRow = Record<string, unknown>;

type Filter = (row: FakeWebCloudRow) => boolean;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createFakeWebCloud({
  ownerId = 'owner-1',
  email = 'owner@example.com',
}: { ownerId?: string; email?: string } = {}) {
  const tables = new Map<string, FakeWebCloudRow[]>();
  const reads: string[] = [];
  const rowsOf = (table: string) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };

  function query(table: string) {
    const filters: Filter[] = [];
    let patch: FakeWebCloudRow | null = null;
    const matching = () => rowsOf(table).filter(row => filters.every(filter => filter(row)));
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: self,
      order: self,
      limit: self,
      lt: self,
      eq(column: string, value: unknown) {
        filters.push(row => row[column] === value);
        return chain;
      },
      in(column: string, values: readonly unknown[]) {
        filters.push(row => values.includes(row[column]));
        return chain;
      },
      upsert(value: FakeWebCloudRow | FakeWebCloudRow[], options?: { onConflict?: string }) {
        const keys = (options?.onConflict || 'id').split(',');
        (Array.isArray(value) ? value : [value]).forEach(entry => {
          const rows = rowsOf(table);
          const index = rows.findIndex(row => keys.every(column => row[column] === entry[column]));
          if (index >= 0) rows[index] = clone(entry); else rows.push(clone(entry));
        });
        return Promise.resolve({ data: null, error: null });
      },
      // A query awaited with no terminal call (select ... in ...).
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        reads.push(table);
        return Promise.resolve({ data: clone(matching()), error: null, status: 200 }).then(resolve, reject);
      },
      update(row: FakeWebCloudRow) {
        patch = clone(row);
        return chain;
      },
      async range(from: number, to: number) {
        reads.push(table);
        const rows = matching();
        return { data: clone(rows.slice(from, to + 1)), error: null, status: 200, count: null };
      },
      async maybeSingle() {
        const rows = matching();
        if (patch) {
          if (rows.length === 0) return { data: null, error: null };
          Object.assign(rows[0], patch);
          return { data: { updated_at: rows[0].updated_at }, error: null };
        }
        return { data: rows[0] ? clone(rows[0]) : null, error: null };
      },
    });
    return chain;
  }

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: ownerId, email } }, error: null }),
      getSession: async () => ({
        data: {
          session: {
            access_token: 'fake-access',
            expires_at: 1_900_000_000,
            user: { id: ownerId, email },
          },
        },
        error: null,
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: async () => ({ error: null }),
    },
    async rpc(name: string) {
      if (name === 'dave_is_app_owner') return { data: true, error: null, status: 200 };
      if (name === 'dave_list_reference_document_metadata') {
        return { data: clone(rowsOf('reference_documents')), error: null, status: 200 };
      }
      return { data: null, error: null, status: 200 };
    },
    from: (table: string) => query(table),
  };

  return {
    client,
    ownerId,
    /** Tables the gateway actually read, in order. */
    reads,
    rows: rowsOf,
    insert(table: string, row: FakeWebCloudRow) {
      rowsOf(table).push(clone(row));
    },
    /** Another device saves a row: its fields and its revision change. */
    change(table: string, id: string, patch: FakeWebCloudRow) {
      const row = rowsOf(table).find(candidate => candidate.id === id);
      if (!row) throw new Error(`No ${table} row ${id}`);
      Object.assign(row, clone(patch));
    },
  };
}

export type FakeWebCloud = ReturnType<typeof createFakeWebCloud>;
