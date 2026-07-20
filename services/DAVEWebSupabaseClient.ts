import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { supabaseSecureAuthStorage } from './SupabaseAuthStorage.web';
import { paginateSupabaseCollection } from './SupabaseCollectionPagination';

export type DAVEWebRawRows = Readonly<{
  projects: readonly unknown[];
  scheduleItems: readonly unknown[];
  projectUpdates: readonly unknown[];
  referenceDocuments: readonly unknown[];
}>;

export type DAVEWebSignInResult = Readonly<{
  ok: boolean;
  session: Session | null;
}>;

export type DAVEWebSessionStatus = Readonly<{
  configured: boolean;
  session: Session | null;
}>;

export class DAVEWebAuthorizationError extends Error {
  constructor(message = 'This account is not authorized for the DAVE desktop pilot.') {
    super(message);
    this.name = 'DAVEWebAuthorizationError';
  }
}

export type DAVEWebSupabaseGateway = ReturnType<typeof createDAVEWebSupabaseGateway>;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

const browserClient = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: supabaseSecureAuthStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export function createDAVEWebSupabaseGateway(client: SupabaseClient | null) {
  return Object.freeze({
    async getSessionStatus(): Promise<DAVEWebSessionStatus> {
      if (!client) return { configured: false, session: null };
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error('The desktop session could not be checked.');
      return { configured: true, session: data.session ?? null };
    },

    subscribeToAuthStateChange(
      callback: (event: AuthChangeEvent, session: Session | null) => void,
    ): () => void {
      if (!client) return () => undefined;
      const { data } = client.auth.onAuthStateChange((event, session) => callback(event, session));
      return () => data.subscription.unsubscribe();
    },

    async signIn(email: string, password: string): Promise<DAVEWebSignInResult> {
      if (!client) return { ok: false, session: null };
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) return { ok: false, session: null };
      return { ok: true, session: data.session };
    },

    async signOut(): Promise<void> {
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) throw new Error('The desktop session could not be closed.');
    },

    async loadAuthorizedRows(): Promise<DAVEWebRawRows> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');

      const { data: userResult, error: userError } = await client.auth.getUser();
      const userId = userResult.user?.id ?? null;
      if (userError || !userId) throw new DAVEWebAuthorizationError('Sign in is required for the DAVE desktop pilot.');

      const { data: authorized, error: authorizationError } = await client.rpc('dave_is_app_owner');
      if (authorizationError || authorized !== true) throw new DAVEWebAuthorizationError();

      const [projects, scheduleItems, projectUpdates, referenceDocuments] = await Promise.all([
        readOwnerRows(client, 'projects', userId, query => query.eq('archived', false).order('created_at', { ascending: false })),
        readOwnerRows(client, 'schedule_items', userId, query => query.order('updated_at', { ascending: false })),
        readOwnerRows(client, 'project_updates', userId, query => query.order('created_at', { ascending: false })),
        readOwnerRows(client, 'reference_documents', userId, query => query.order('updated_at', { ascending: false })),
      ]);

      return Object.freeze({ projects, scheduleItems, projectUpdates, referenceDocuments });
    },
  });
}

export const daveWebSupabaseGateway = createDAVEWebSupabaseGateway(browserClient);

async function readOwnerRows(
  client: SupabaseClient,
  table: string,
  ownerId: string,
  refine: (query: any) => any,
): Promise<readonly unknown[]> {
  const result = await paginateSupabaseCollection(({ from, to, includeExactCount }) => {
    const baseQuery = client
      .from(table)
      .select('*', { count: includeExactCount ? 'exact' : undefined })
      .eq('owner_id', ownerId);
    return refine(baseQuery).range(from, to);
  });

  if (!result.ok) throw new Error(`Authorized ${table.replace(/_/g, ' ')} could not be loaded.`);
  return Object.freeze([...result.rows]);
}
