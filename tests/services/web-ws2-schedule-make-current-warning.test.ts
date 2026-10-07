import { loadDAVEWebCloudReferenceDocuments, loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import {
  DAVE_WEB_SCHEDULE_CHANGED_TEXT,
  DAVE_WEB_SCHEDULES_UNREADABLE_TEXT,
  daveWebScheduleRetirementCheck,
} from '../../services/DAVEWebScheduleActivation';
import { createDAVEWebSupabaseGateway, daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

// Open item, web batch WS2 item 3 (WS1 item 3; 6 Oct 2026): the web made a
// schedule current with no warning that it retires ANOTHER project's
// schedule. "Combined" is the current schedule for Alpha and Beta. Making
// "Alpha rev 2" current, on a cloud that retires whole schedules, retires
// Combined for Beta too. The question is the phone's, from the cloud's own
// current flags and from what this cloud retires. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  ...jest.requireActual('../../services/DAVEWebSupabaseClient'),
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn(), loadAuthorizedScheduleRetirementScope: jest.fn() },
}));

const row = (id: string, importedAt: string, projects: string[], isCurrent: boolean) => ({
  id, owner_id: 'owner-1', name: id, category: 'Schedules', updated_at: '2026-10-06T12:00:00.000Z',
  document_data: {
    id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent, importedAt,
    projectId: null, projectName: projects.length === 1 ? projects[0] : null, projectNames: projects, importBatchId: `batch-${id}`,
  },
});
const OLD_BETA = row('Beta 2025', '2026-08-01T12:00:00.000Z', ['Beta'], true);
const COMBINED = row('Combined', '2026-09-01T12:00:00.000Z', ['Alpha', 'Beta'], true);
const ALPHA_2 = row('Alpha rev 2', '2026-10-01T12:00:00.000Z', ['Alpha'], false);

function cloud(documents: ReturnType<typeof row>[], scope: 'schedule' | 'project' | null, deleted: string[] = []) {
  jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
    projects: [], scheduleItems: [], projectUpdates: [], referenceDocuments: documents,
    syncTombstones: deleted.map(id => ({ owner_id: 'owner-1', entity_type: 'reference_document', record_id: id, deleted_at: '2026-10-05T12:00:00.000Z' })),
  } as never);
  jest.mocked(daveWebSupabaseGateway.loadAuthorizedScheduleRetirementScope).mockResolvedValue(scope);
}

beforeEach(() => jest.clearAllMocks());

describe('what making a schedule current does to another project, asked before it is done (WS2 item 3)', () => {
  it('a cloud that retires whole schedules: Beta is named, and what it is left with', async () => {
    cloud([COMBINED, ALPHA_2], 'schedule');
    expect(await daveWebScheduleRetirementCheck({ id: 'Alpha rev 2' })).toEqual({
      ok: true,
      effects: [{ projectName: 'Beta', fallbackSchedule: null }],
      message: 'The schedule now current for Beta will be retired too. Beta is left with no current schedule and shows no schedule tasks until you set one.',
    });
  });

  it('from the cloud\'s own current flags: an older Beta schedule the cloud still marks current is what Beta goes back to', async () => {
    cloud([OLD_BETA, COMBINED, ALPHA_2], 'schedule');
    const check = await daveWebScheduleRetirementCheck({ id: 'Alpha rev 2' });
    expect(check.ok && check.message).toBe('The schedule now current for Beta will be retired too. Beta goes back to Beta 2025, an older schedule still marked current there.');
    // The page's own list marks one current schedule per project, so it cannot tell: there Beta 2025 reads as retired.
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(snapshot.referenceDocuments.find(document => document.id === 'Beta 2025')!.isCurrent).toBe(false);
    expect((await loadDAVEWebCloudReferenceDocuments()).find(document => document.id === 'Beta 2025')!.isCurrent).toBe(true);
  });

  it('a cloud that keeps a combined schedule current for its other projects: nothing to ask', async () => {
    cloud([COMBINED, ALPHA_2], 'project');
    expect(await daveWebScheduleRetirementCheck({ id: 'Alpha rev 2' })).toEqual({ ok: true, effects: [], message: '' });
  });

  it('a schedule deleted on another device is not counted as one a project can go back to', async () => {
    cloud([OLD_BETA, COMBINED, ALPHA_2], 'schedule', ['Beta 2025']);
    const check = await daveWebScheduleRetirementCheck({ id: 'Alpha rev 2' });
    expect(check.ok && check.message).toContain('Beta is left with no current schedule');
  });

  it('when the cloud does not say what it retires, or cannot be read, nothing is made current and he is told why', async () => {
    cloud([COMBINED, ALPHA_2], null);
    expect(await daveWebScheduleRetirementCheck({ id: 'Alpha rev 2' })).toEqual({ ok: false, message: DAVE_WEB_SCHEDULES_UNREADABLE_TEXT });
    cloud([COMBINED, ALPHA_2], 'schedule');
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockRejectedValue(new Error('network'));
    expect(await daveWebScheduleRetirementCheck({ id: 'Alpha rev 2' })).toEqual({ ok: false, message: DAVE_WEB_SCHEDULES_UNREADABLE_TEXT });
    expect(DAVE_WEB_SCHEDULES_UNREADABLE_TEXT).toBe('The shared schedules could not be read. Try again shortly.');
  });

  it('a schedule that is no longer in the cloud is not made current', async () => {
    cloud([COMBINED], 'schedule');
    expect(await daveWebScheduleRetirementCheck({ id: 'Alpha rev 2' })).toEqual({ ok: false, message: DAVE_WEB_SCHEDULE_CHANGED_TEXT });
  });

  it('guard: a schedule that touches only its own project asks nothing', async () => {
    cloud([row('Alpha rev 1', '2026-09-01T12:00:00.000Z', ['Alpha'], true), ALPHA_2], 'schedule');
    expect(await daveWebScheduleRetirementCheck({ id: 'Alpha rev 2' })).toEqual({ ok: true, effects: [], message: '' });
  });
});

describe('the one read added to the web\'s cloud client (WS2 item 3)', () => {
  function client(answer: { data: unknown; error: unknown }, owner = true) {
    const calls: string[] = [];
    const fake = {
      auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }) },
      rpc: async (name: string) => {
        calls.push(name);
        return name === 'dave_is_app_owner' ? { data: owner, error: null, status: 200 } : answer;
      },
      from: () => { throw new Error('this read touches no table'); },
    };
    return { gateway: createDAVEWebSupabaseGateway(fake as never), calls };
  }

  it('asks the cloud\'s own function, after the owner check, and writes nothing', async () => {
    const perProject = client({ data: 'project', error: null });
    expect(await perProject.gateway.loadAuthorizedScheduleRetirementScope()).toBe('project');
    expect(perProject.calls).toEqual(['dave_is_app_owner', 'ecos_schedule_retirement_scope']);
    expect(await client({ data: 'schedule', error: null }).gateway.loadAuthorizedScheduleRetirementScope()).toBe('schedule');
  });

  it('someone who is not the owner gets no answer', async () => {
    await expect(client({ data: 'project', error: null }, false).gateway.loadAuthorizedScheduleRetirementScope()).rejects.toThrow();
  });

  it('with no cloud connection it answers "unknown"', async () => {
    expect(await createDAVEWebSupabaseGateway(null).loadAuthorizedScheduleRetirementScope()).toBeNull();
  });
});
