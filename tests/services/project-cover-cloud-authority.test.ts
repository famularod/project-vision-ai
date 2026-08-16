const projectQuery: Record<string, jest.Mock> = {};
for (const method of ['update', 'eq', 'select', 'limit']) {
  projectQuery[method] = jest.fn(() => projectQuery);
}
projectQuery.maybeSingle = jest.fn(async () => ({
  data: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Shared Project',
    project_data: { coverPhotoMode: 'automatic' },
  },
  error: null,
  status: 200,
}));

const from = jest.fn(() => projectQuery);
const rpc = jest.fn(async () => ({
  data: { status: 'committed' },
  error: null,
  status: 200,
}));
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
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
  from,
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
    select: (values: Record<string, unknown>) => values.ios ?? values.native ?? values.default,
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

describe('project cover cloud authority', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let updateProject: typeof import('../../services/SupabaseService').updateProject;
  let commitProjectCoverPhoto:
    typeof import('../../services/SupabaseService').commitProjectCoverPhoto;

  const id = '11111111-1111-4111-8111-111111111111';
  const remotePath =
    `project-covers/${id}/revisions/33333333-3333-4333-8333-333333333333.jpg`;
  const contentSha256 = 'a'.repeat(64);
  const mutation = () => ({
    expected: {
      coverPhoto: null,
      mode: 'automatic' as const,
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    target: {
      coverPhoto: {
        remotePath,
        mimeType: 'image/jpeg',
        contentSha256,
        sizeBytes: 1234,
        updatedAt: '2026-08-10T00:01:00.000Z',
      },
      mode: 'manual' as const,
      updatedAt: '2026-08-10T00:01:00.000Z',
    },
  });

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    ({ updateProject, commitProjectCoverPhoto } = require('../../services/SupabaseService'));
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockResolvedValue({ data: { status: 'committed' }, error: null, status: 200 });
  });

  it('rejects a name-only cover mutation before selecting any cloud row', async () => {
    const result = await updateProject({
      previousName: 'Shared Project',
      data: {
        coverPhoto: null,
        coverPhotoMode: 'automatic',
        coverPhotoUpdatedAt: '2026-08-10T00:00:00.000Z',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Cover photo updates require the atomic project-cover commit authority.',
      code: 'project_cover_atomic_commit_required',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects even an exact generic cover update so callers cannot bypass the CAS', async () => {
    const result = await updateProject({
      id,
      previousName: 'Shared Project',
      data: {
        coverPhoto: null,
        coverPhotoMode: 'automatic',
        coverPhotoUpdatedAt: '2026-08-10T00:00:00.000Z',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'project_cover_atomic_commit_required',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('commits a valid immutable cover through the exact atomic RPC', async () => {
    const result = await commitProjectCoverPhoto({
      projectId: id,
      expectedProjectName: 'Shared Project',
      mutation: mutation(),
    });

    expect(result).toMatchObject({ ok: true, data: { status: 'committed' } });
    expect(rpc).toHaveBeenCalledWith('dave_commit_project_cover_photo', {
      p_project_id: id,
      p_expected_project_name: 'Shared Project',
      p_expected_cover_photo: null,
      p_expected_cover_photo_mode: 'automatic',
      p_expected_cover_updated_at: '2026-08-10T00:00:00.000Z',
      p_target_cover_photo: mutation().target.coverPhoto,
      p_target_cover_photo_mode: 'manual',
      p_target_cover_updated_at: '2026-08-10T00:01:00.000Z',
    });
  });

  it('rejects a target object outside the exact project revision namespace', async () => {
    const invalid = mutation();
    const result = await commitProjectCoverPhoto({
      projectId: id,
      expectedProjectName: 'Shared Project',
      mutation: {
        ...invalid,
        target: {
          ...invalid.target,
          coverPhoto: {
            ...invalid.target.coverPhoto!,
            remotePath:
              'project-covers/22222222-2222-4222-8222-222222222222/revisions/33333333-3333-4333-8333-333333333333.jpg',
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the RPC response is not an exact commit receipt', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'maybe' }, error: null, status: 200 });
    const result = await commitProjectCoverPhoto({
      projectId: id,
      expectedProjectName: 'Shared Project',
      mutation: mutation(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exact project-cover commit receipt/i);
  });

});
