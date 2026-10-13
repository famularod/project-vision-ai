import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import {
  createDAVEWebSupabaseGateway,
  daveWebSupabaseGateway,
} from '../../services/DAVEWebSupabaseClient';
import { buildDAVEWebScheduleItem, scheduleItemForCloud, type DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import {
  DAVE_WEB_LINK_CHECK_FAILED_TEXT,
  daveWebLinkCircleClosedBy,
  daveWebLinkCircleRefusal,
  daveWebLinkCircleText,
} from '../../services/DAVEWebTaskLinkCircle';
import type { ScheduleItem } from '../../types';

// Open item, web batch WS1 item 7 (6 Oct 2026): two web sessions can each
// save one of two opposite hand links. Session one sets Framing to start
// after Survey; session two, which opened before it heard of that, sets
// Survey to start after Framing. Each write is guarded only by its own
// task's revision, so both went in: a circle.
//
// Two sessions here are two reads of one in-memory cloud through the real
// gateway and the real loader. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  ...jest.requireActual('../../services/DAVEWebSupabaseClient'),
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

type Row = Record<string, any>;

/** Just enough of Supabase for the gateway: owner-filtered rows, a trigger-like updated_at. */
function memoryCloud() {
  const tables: Record<string, Row[]> = { schedule_items: [], reference_documents: [], dave_sync_tombstones: [] };
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 9, 30, 12, 0, 0, clock++)).toISOString();
  const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  function from(table: string) {
    const rows = (tables[table] ??= []);
    let action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let payload: Row | Row[] = {};
    const filters: [string, unknown][] = [];
    const matching = () => rows.filter(row => filters.every(([key, value]) => row[key] === value));
    const execute = (): { data: any; error: any } => {
      if (action === 'insert' || action === 'upsert') {
        const incoming = ([] as Row[]).concat(payload).map(copy);
        if (action === 'insert' && incoming.some(row => row.id && rows.some(existing => existing.id === row.id))) {
          return { data: null, error: { message: 'duplicate key' } };
        }
        incoming.forEach(row => rows.push({ ...row, updated_at: now() }));
        return { data: null, error: null };
      }
      if (action === 'update') {
        const hits = matching();
        hits.forEach(row => Object.assign(row, copy(payload), { updated_at: now() }));
        return { data: hits.map(copy), error: null };
      }
      if (action === 'delete') {
        const hits = matching();
        hits.forEach(row => rows.splice(rows.indexOf(row), 1));
        return { data: hits, error: null };
      }
      return { data: matching().map(copy), error: null };
    };
    const builder: any = {
      select: () => builder,
      order: () => builder,
      insert: (value: Row | Row[]) => { action = 'insert'; payload = value; return builder; },
      update: (value: Row) => { action = 'update'; payload = value; return builder; },
      upsert: (value: Row | Row[]) => { action = 'upsert'; payload = value; return builder; },
      delete: () => { action = 'delete'; return builder; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      range: async () => ({ ...execute(), status: 200 }),
      maybeSingle: async () => {
        const { data, error } = execute();
        return { data: Array.isArray(data) ? data[0] ?? null : data, error };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(execute()).then(resolve, reject),
    };
    return builder;
  }
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    rpc: async (name: string) => ({ data: name === 'dave_is_app_owner' ? true : null, error: null }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    from,
  };
  return { tables, client: client as any, now };
}

const NOW = '2026-10-06T18:00:00.000Z';

function task(id: string, taskName: string, extra: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id, projectId: 'alpha', itemType: 'Task', scheduleProjectName: 'Alpha', projectName: 'Alpha', locationName: 'Lot', taskName,
    startDate: '10/05/2026', finishDate: '10/09/2026', milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium',
    status: 'Not Started', notes: '', nextAction: '', activity: [], createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
    ...extra,
  } as ScheduleItem;
}
const after = (...ids: string[]) => ({ dependencies: ids.map(predecessorItemId => ({ predecessorItemId, type: 'FS' as const, lagDays: 0 })) });
const cloudOf = (shown: ScheduleItem[], hidden: ScheduleItem[] = []) =>
  ({ scheduleItems: shown as DAVEWebScheduleItem[], knownScheduleItems: [...shown, ...hidden] });

describe('a link that would close a circle with the tasks the cloud holds (WS1 item 7): the rule', () => {
  const framing = task('framing', 'Framing');
  const survey = task('survey', 'Survey');
  const roofing = task('roofing', 'Roofing');

  it('Survey after Framing, when the cloud already has Framing after Survey: a circle, named', () => {
    const circle = daveWebLinkCircleClosedBy({
      item: { ...survey, ...after('framing') }, opened: survey, cloud: cloudOf([{ ...framing, ...after('survey') }, survey]),
    });
    expect(circle && [circle.task.taskName, circle.predecessor.taskName, circle.through.length]).toEqual(['Survey', 'Framing', 0]);
    expect(daveWebLinkCircleText(circle!)).toBe(
      'Not saved. “Framing” is already set to start after “Survey”, on another device or in another browser tab. Making “Survey” start after “Framing” as well would put them in a circle, and the schedule could not place either one. Untick “Framing” and save again, or remove the other link first.',
    );
  });

  it('round through a third task, which the sentence names', () => {
    const circle = daveWebLinkCircleClosedBy({
      item: { ...survey, ...after('roofing') }, opened: survey,
      cloud: cloudOf([{ ...framing, ...after('survey') }, { ...roofing, ...after('framing') }, survey]),
    });
    expect(circle && [circle.predecessor.taskName, circle.through.map(step => step.taskName)]).toEqual(['Roofing', ['Framing']]);
    expect(daveWebLinkCircleText(circle!)).toContain('“Roofing” already comes after “Survey” (through “Framing”), on another device or in another browser tab.');
  });

  it('by task: the other link names the row a master has since replaced, and still counts', () => {
    const oldSurvey = task('survey-old', 'Survey', { importBatchId: 'batch-F' });
    const newSurvey = task('survey', 'Survey', { importBatchId: 'batch-G', revisedFromTaskIds: ['survey-old'] });
    const circle = daveWebLinkCircleClosedBy({
      item: { ...newSurvey, ...after('framing') }, opened: newSurvey, cloud: cloudOf([{ ...framing, ...after('survey-old') }, newSurvey], [oldSurvey]),
    });
    expect(circle?.predecessor.taskName).toBe('Framing');
  });

  it('by task: a link only a replaced, hidden row still holds is not the task\'s, so it closes nothing', () => {
    const oldFraming = task('framing-old', 'Framing', { importBatchId: 'batch-F', ...after('survey') });
    const newFraming = task('framing', 'Framing', { importBatchId: 'batch-G', revisedFromTaskIds: ['framing-old'] });
    expect(daveWebLinkCircleClosedBy({
      item: { ...survey, ...after('framing') }, opened: survey, cloud: cloudOf([newFraming, survey], [oldFraming]),
    })).toBeNull();
  });

  it('only a link this save adds: a circle already saved is not this save\'s doing', () => {
    const inCircle = { ...survey, ...after('framing') };
    expect(daveWebLinkCircleClosedBy({
      item: { ...inCircle, notes: 'Edited' }, opened: inCircle, cloud: cloudOf([{ ...framing, ...after('survey') }, inCircle]),
    })).toBeNull();
    // Removing it is never refused.
    expect(daveWebLinkCircleClosedBy({
      item: { ...survey, dependencies: [] }, opened: inCircle, cloud: cloudOf([{ ...framing, ...after('survey') }, inCircle]),
    })).toBeNull();
  });

  it('a link that closes no circle is not refused', () => {
    expect(daveWebLinkCircleClosedBy({
      item: { ...roofing, ...after('framing') }, opened: roofing, cloud: cloudOf([{ ...framing, ...after('survey') }, survey, roofing]),
    })).toBeNull();
  });

  it('the cloud is read only when the save adds a link, and a read that fails refuses the save in plain words', async () => {
    const load = jest.fn(async () => cloudOf([framing, survey]));
    expect(await daveWebLinkCircleRefusal({ item: { ...survey, notes: 'Edited' }, opened: survey, load })).toBeNull();
    expect(await daveWebLinkCircleRefusal({ item: { ...survey, dependencies: [] }, opened: { ...survey, ...after('framing') }, load })).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(await daveWebLinkCircleRefusal({ item: { ...survey, ...after('framing') }, opened: survey, load })).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    // A link the editor only re-points to the row shown for the same task is not a new link: nothing is read.
    const oldRow = { ...survey, ...after('framing-old') };
    const shownIdOf = (id: string) => (id === 'framing-old' ? 'framing' : id);
    expect(await daveWebLinkCircleRefusal({ item: { ...survey, ...after('framing') }, opened: oldRow, shownIdOf, load })).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    const offline = jest.fn(async () => { throw new Error('network'); });
    expect(await daveWebLinkCircleRefusal({ item: { ...survey, ...after('framing') }, opened: survey, load: offline })).toBe(DAVE_WEB_LINK_CHECK_FAILED_TEXT);
    expect(DAVE_WEB_LINK_CHECK_FAILED_TEXT).toBe('Not saved. Vitruvius could not read the latest schedule to check this new link against it. Check your connection and try again.');
  });
});

describe('two web sessions, each saving one of two opposite links (WS1 item 7)', () => {
  let cloud: ReturnType<typeof memoryCloud>;
  let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;

  beforeEach(() => {
    cloud = memoryCloud();
    gateway = createDAVEWebSupabaseGateway(cloud.client);
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockImplementation(async () => ({
      projects: [{ id: 'alpha', name: 'Alpha', archived: false }],
      scheduleItems: cloud.tables.schedule_items,
      projectUpdates: [],
      referenceDocuments: cloud.tables.reference_documents,
      syncTombstones: cloud.tables.dave_sync_tombstones,
    }) as never);
    [task('framing', 'Framing'), task('survey', 'Survey')].forEach(item => cloud.tables.schedule_items.push({
      id: item.id, owner_id: 'owner-1', project_id: item.projectId, project_name: item.projectName, task_name: item.taskName, item_data: item, updated_at: cloud.now(),
    }));
  });

  /** One session's editor: the task as that session read it, saved with a new predecessor. */
  function withPredecessor(opened: DAVEWebScheduleItem, predecessorId: string): DAVEWebScheduleItem {
    return buildDAVEWebScheduleItem({
      draft: {
        projectId: opened.projectId, itemType: 'Task', taskName: opened.taskName, projectName: opened.projectName, locationName: opened.locationName,
        startDate: opened.startDate, finishDate: opened.finishDate, milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium',
        status: 'Not Started', notes: '', nextAction: '', activityMessage: '', ...after(predecessorId),
      },
      current: opened, id: opened.id, now: NOW, actor: 'david@example.com',
    });
  }
  const linksInCloud = () => Object.fromEntries(cloud.tables.schedule_items
    .map(row => [row.item_data.taskName, (row.item_data.dependencies ?? []).map((link: { predecessorItemId: string }) => link.predecessorItemId)]));

  it('the second save is refused with a sentence, and the cloud keeps one link and no circle', async () => {
    // Both sessions open the schedule before either link exists.
    const one = await loadDAVEWebReadOnlySnapshot();
    const two = await loadDAVEWebReadOnlySnapshot();
    const openedOf = (snapshot: typeof one, name: string) => snapshot.scheduleItems.find(item => item.taskName === name)!;

    const framing = withPredecessor(openedOf(one, 'Framing'), 'survey');
    expect(await daveWebLinkCircleRefusal({ item: framing, opened: openedOf(one, 'Framing') })).toBeNull();
    await gateway.updateAuthorizedScheduleItem(scheduleItemForCloud(framing), framing.cloudUpdatedAt);

    // Session two has not heard of it: its copy of Survey is still the one it opened.
    const survey = withPredecessor(openedOf(two, 'Survey'), 'framing');
    const refusal = await daveWebLinkCircleRefusal({ item: survey, opened: openedOf(two, 'Survey') });
    expect(refusal).toBe(
      'Not saved. “Framing” is already set to start after “Survey”, on another device or in another browser tab. Making “Survey” start after “Framing” as well would put them in a circle, and the schedule could not place either one. Untick “Framing” and save again, or remove the other link first.',
    );
    expect(linksInCloud()).toEqual({ Framing: ['survey'], Survey: [] });
  });

  it('guard (what happened without the check): the cloud takes the second write, since only Survey\'s own revision guards it', async () => {
    const one = await loadDAVEWebReadOnlySnapshot();
    const two = await loadDAVEWebReadOnlySnapshot();
    const framing = withPredecessor(one.scheduleItems.find(item => item.taskName === 'Framing')!, 'survey');
    await gateway.updateAuthorizedScheduleItem(scheduleItemForCloud(framing), framing.cloudUpdatedAt);
    const survey = withPredecessor(two.scheduleItems.find(item => item.taskName === 'Survey')!, 'framing');
    await gateway.updateAuthorizedScheduleItem(scheduleItemForCloud(survey), survey.cloudUpdatedAt);
    expect(linksInCloud()).toEqual({ Framing: ['survey'], Survey: ['framing'] });
  });
});
