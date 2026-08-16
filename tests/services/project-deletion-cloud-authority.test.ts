const rpc: jest.Mock = jest.fn(async () => ({ data: null, error: null, status: 200 }));
const mockSupabaseClient = {
  auth: {
    getSession: jest.fn(async () => ({
      data: {
        session: {
          access_token: 'session-token',
          user: { id: 'owner-1' },
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    })),
    getUser: jest.fn(async () => ({
      data: { user: { id: 'owner-1' } },
      error: null,
    })),
    onAuthStateChange: jest.fn(() => ({
      data: { subscription: { unsubscribe: jest.fn() } },
    })),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
  rpc,
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
  NativeModules: {},
  Platform: {
    OS: 'ios',
    select: (values: Record<string, unknown>) =>
      values.ios ?? values.native ?? values.default,
  },
  TurboModuleRegistry: { get: jest.fn(() => null) },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../../services/SupabaseAuthStorage', () => ({
  isAuthStorageSecure: jest.fn(async () => true),
  supabaseSecureAuthStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

describe('project deletion cloud authority', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let deleteProject: typeof import('../../services/SupabaseService').deleteProject;

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    ({ deleteProject } = require('../../services/SupabaseService'));
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockResolvedValue({ data: null, error: null, status: 200 });
  });

  it('rejects a name-only request before invoking the destructive RPC', async () => {
    const result = await deleteProject({
      projectId: '',
      name: 'Shared Project',
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Project delete requires one exact project ID and display name.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes the selected immutable id and matching display name to the RPC', async () => {
    const result = await deleteProject({
      projectId: '11111111-1111-4111-8111-111111111111',
      name: 'Shared Project',
    });

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('dave_delete_project_atomically', {
      p_project_id: '11111111-1111-4111-8111-111111111111',
      p_project_name: 'Shared Project',
    });
  });

  it('fails closed when the exact-id overload is not deployed', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'function overload not found' },
      status: 404,
    });

    const result = await deleteProject({
      projectId: '11111111-1111-4111-8111-111111111111',
      name: 'Shared Project',
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'PGRST202',
      error: expect.stringMatching(/Exact-ID protected project deletion is not available yet/i),
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
