import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  canonicalizeDAVEScheduleItems,
  daveRegisteredIdentityNames,
  resolveDAVEIdentity,
  buildDAVEIdentityRegistry,
  type DAVEIdentityCorrection,
} from '../../services/DAVEIdentity';
import { createDAVEIdentityRepository } from '../../services/DAVEIdentityRepository';
import {
  DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY,
  markDAVEIdentityAliasCleanupScheduleRefreshed,
  runDAVEIdentityAliasCleanup,
  scheduleItemsSafeForFullSync,
} from '../../services/DAVEIdentityAliasCleanup';
import { isOwnerSensitiveCanonicalStorageKey } from '../../services/OwnerStorageSandbox';
import type { ProjectArea, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

// Whole-app audit A11 pass 2 (30 Sep 2026), verified HIGH: picking "Roof"
// instead of the suggested "Level 2 corridor" in Confirm Memory saved the
// correction as a name alias, and every Level 2 corridor task on the project
// moved to Roof; tapping Roof and back blanked both areas to "Area Not
// Assigned". Synthetic project data only.

const P2321 = '2321 Compliance Project';
const P2375 = '2375 Compliance Project';

const areas = [
  { id: 'area-l2', name: 'Level 2 corridor', projectName: P2321 },
  { id: 'area-roof', name: 'Roof', projectName: P2321 },
] as unknown as ProjectArea[];
const registeredNames = daveRegisteredIdentityNames({ projectNames: [P2321, P2375], projectAreas: areas });

function task(id: string, locationName: string, projectName = P2321): ScheduleItem {
  return {
    id,
    scheduleProjectName: projectName,
    projectName,
    locationName,
    taskName: `Task ${id}`,
    startDate: '09/01/2026',
    finishDate: '09/30/2026',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 40,
    priority: 'High',
    status: 'In Progress',
    notes: '',
    createdAt: '2026-09-01T12:00:00.000Z',
  } as unknown as ScheduleItem;
}

// Exactly what Confirm Memory used to save for a location correction.
function confirmMemoryAlias(
  rawName: string,
  canonicalName: string,
  confirmedAt: string,
  kind: DAVEIdentityCorrection['kind'] = 'area',
): DAVEIdentityCorrection {
  return {
    id: `identity:memory-1:${kind}:${confirmedAt}`,
    kind,
    rawName,
    canonicalName,
    parentProjectName: kind === 'area' ? P2321 : null,
    sourceRecordId: 'memory-1',
    confirmedAt,
    confirmedBy: 'Project manager',
  };
}

// A11 pass 3: Confirm Memory rules are all ignored and removed now, so a
// spelling rule in these tests is one Confirm Memory did not save.
function spellingAlias(rawName: string, canonicalName: string, confirmedAt: string): DAVEIdentityCorrection {
  return {
    id: `spelling:${rawName}`,
    kind: 'area',
    rawName,
    canonicalName,
    parentProjectName: P2321,
    sourceRecordId: 'owner-spelling-fix',
    confirmedAt,
    confirmedBy: 'Project manager',
  };
}

const tasks = [task('t1', 'Level 2 corridor'), task('t2', 'Level 2 corridor'), task('t3', 'Roof')];
const areaNames = (items: readonly ScheduleItem[]) => items.map(item => item.locationName);

describe('audit A11 pass 2: a Confirm Memory correction renames no real place', () => {
  it('saving a confirmed memory learns no name alias', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    const start = app.indexOf('async function saveCaptureMemory(');
    const body = app.slice(start, app.indexOf('async function finishProjectWalk(', start));
    expect(start).toBeGreaterThan(0);
    expect(body).not.toMatch(/IdentityRepository|identityLearning|setIdentityCorrections/);
    expect(app).not.toMatch(/localDAVEIdentityRepository\.save\(/);
  });

  it('picking Roof moves no Level 2 corridor task, even with the old alias saved', () => {
    const result = canonicalizeDAVEScheduleItems(tasks, {
      projectNames: [P2321],
      projectAreas: areas,
      corrections: [confirmMemoryAlias('Level 2 corridor', 'Roof', '2026-09-30T12:00:00.000Z')],
      registeredNames,
    });
    expect(areaNames(result.items)).toEqual(['Level 2 corridor', 'Level 2 corridor', 'Roof']);
  });

  it('tapping Roof and back to Level 2 corridor blanks no area', () => {
    const corrections = [
      confirmMemoryAlias('Level 2 corridor', 'Roof', '2026-09-30T12:00:00.000Z'),
      confirmMemoryAlias('Roof', 'Level 2 corridor', '2026-09-30T12:00:05.000Z'),
    ];
    const guarded = canonicalizeDAVEScheduleItems(tasks, {
      projectNames: [P2321], projectAreas: areas, corrections, registeredNames,
    });
    expect(areaNames(guarded.items)).toEqual(['Level 2 corridor', 'Level 2 corridor', 'Roof']);
    // Areas known only from task rows are not registered; the exact name
    // still wins over the other area's alias instead of blanking both.
    const unregistered = canonicalizeDAVEScheduleItems(tasks, { projectNames: [P2321], corrections });
    expect(areaNames(unregistered.items)).toEqual(['Level 2 corridor', 'Level 2 corridor', 'Roof']);
  });

  it('refuses a project alias whose old name is a real project', () => {
    const result = canonicalizeDAVEScheduleItems([task('t1', 'Roof')], {
      projectNames: [P2321, P2375],
      corrections: [confirmMemoryAlias(P2321, P2375, '2026-09-30T12:00:00.000Z', 'project')],
      registeredNames,
    });
    expect(result.items[0].projectName).toBe(P2321);
  });

  it('still applies a spelling alias (Pump Hse -> Pump House)', () => {
    const result = canonicalizeDAVEScheduleItems([task('t1', 'Pump Hse')], {
      projectNames: [P2321],
      projectAreas: areas,
      corrections: [spellingAlias('Pump Hse', 'Pump House', '2026-09-30T12:00:00.000Z')],
      registeredNames,
    });
    expect(result.items[0].locationName).toBe('Pump House');
  });

  it('an exact name wins a clash with another entity alias', () => {
    const registry = buildDAVEIdentityRegistry({
      projectNames: [P2321],
      scheduleItems: tasks,
      corrections: [
        confirmMemoryAlias('Level 2 corridor', 'Roof', '2026-09-30T12:00:00.000Z'),
        confirmMemoryAlias('Roof', 'Level 2 corridor', '2026-09-30T12:00:05.000Z'),
      ],
    });
    const resolution = resolveDAVEIdentity({
      rawName: 'Roof', expectedKind: 'area', registry, parentProjectName: P2321,
    });
    expect(resolution.status).toBe('resolved');
    expect(resolution.entity?.canonicalName).toBe('Roof');
  });
});

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { values.delete(key); }),
  };
}

describe('audit A11 pass 2: one-time cleanup of saved aliases', () => {
  async function seeded() {
    const storage = memoryStorage();
    const repository = createDAVEIdentityRepository(storage);
    await repository.save(confirmMemoryAlias('Level 2 corridor', 'Roof', '2026-09-30T12:00:00.000Z'));
    await repository.save(spellingAlias('Pump Hse', 'Pump House', '2026-09-30T12:01:00.000Z'));
    await repository.save(confirmMemoryAlias(P2321, P2375, '2026-09-30T12:02:00.000Z', 'project'));
    return { storage, repository };
  }

  it('removes aliases of real names, keeps a spelling alias, and runs once per owner', async () => {
    const { storage, repository } = await seeded();
    const first = await runDAVEIdentityAliasCleanup({ registeredNames, repository, storage });
    expect(first.alreadyDone).toBe(false);
    expect(first.removed.map(item => item.rawName).sort()).toEqual([P2321, 'Level 2 corridor'].sort());
    expect(first.corrections.map(item => item.rawName)).toEqual(['Pump Hse']);
    expect((await repository.list()).map(item => item.rawName)).toEqual(['Pump Hse']);
    expect(first.awaitingScheduleRefresh).toHaveLength(2);
    // The marker is an `@dave/` key, which the owner storage sandbox keeps per owner.
    expect(isOwnerSensitiveCanonicalStorageKey(DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY)).toBe(true);

    await repository.save(confirmMemoryAlias('Roof', 'Level 2 corridor', '2026-09-30T13:00:00.000Z'));
    const second = await runDAVEIdentityAliasCleanup({ registeredNames, repository, storage });
    expect(second.alreadyDone).toBe(true);
    expect(second.removed).toEqual([]);
    expect((await repository.list()).map(item => item.rawName).sort()).toEqual(['Pump Hse', 'Roof']);
    expect(second.awaitingScheduleRefresh).toHaveLength(2);
  });

  it('keeps possibly renamed tasks out of Sync Now until the cloud refresh lands', async () => {
    const { storage, repository } = await seeded();
    const { awaitingScheduleRefresh } = await runDAVEIdentityAliasCleanup({ registeredNames, repository, storage });
    const phone = [task('t1', 'Roof'), task('t2', ''), task('t9', 'North Lot', 'Other Project')];
    expect(scheduleItemsSafeForFullSync(phone, awaitingScheduleRefresh).map(item => item.id)).toEqual(['t9']);

    await markDAVEIdentityAliasCleanupScheduleRefreshed(storage);
    const afterRefresh = await runDAVEIdentityAliasCleanup({ registeredNames, repository, storage });
    expect(afterRefresh.awaitingScheduleRefresh).toEqual([]);
    expect(scheduleItemsSafeForFullSync(phone, afterRefresh.awaitingScheduleRefresh)).toBe(phone);
  });

  it('an owner with no bad aliases changes nothing and needs no refresh', async () => {
    const storage = memoryStorage();
    const repository = createDAVEIdentityRepository(storage);
    await repository.save(spellingAlias('Pump Hse', 'Pump House', '2026-09-30T12:01:00.000Z'));
    const result = await runDAVEIdentityAliasCleanup({ registeredNames, repository, storage });
    expect(result.removed).toEqual([]);
    expect(result.awaitingScheduleRefresh).toEqual([]);
    expect(storage.values.has(DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY)).toBe(true);
  });

  it('startup waits for the cleanup, Sync Now leaves renamed tasks out, and the refresh clears it', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain('if (!identityAliasCleanup.done) return;');
    expect(app).toContain('scheduleItems={identityAliasCleanup.scheduleItemsForFullSync}');
    const scheduleRefresh = app.slice(app.indexOf("shouldRefresh('schedule_items')"));
    expect(scheduleRefresh.slice(0, 2200)).toContain('identityAliasCleanup.markScheduleRefreshed()');
    expect(app).toContain('daveRegisteredIdentityNames({ projectNames: projectsCurrentRef.current');
  });
});

// Whole-app audit A11 pass 3 (30 Sep 2026): the cleanup above removed a rule
// only while its old name was still a saved area. After David renamed
// "Level 2 corridor" to "L2 corridor" (or deleted it), "Level 2 corridor ->
// Roof" survived and still moved every task whose area read "Level 2
// corridor" to Roof at each launch and on schedule import approval.
describe('audit A11 pass 3: a Confirm Memory rule for a renamed or deleted area', () => {
  const renamedAreas = [
    { id: 'area-l2', name: 'L2 corridor', projectName: P2321 },
    { id: 'area-roof', name: 'Roof', projectName: P2321 },
  ] as unknown as ProjectArea[];
  const namesAfterRename = daveRegisteredIdentityNames({ projectNames: [P2321, P2375], projectAreas: renamedAreas });
  const staleRule = confirmMemoryAlias('Level 2 corridor', 'Roof', '2026-09-30T12:00:00.000Z');

  it('moves no task, even while the rule is still saved', () => {
    const result = canonicalizeDAVEScheduleItems(tasks, {
      projectNames: [P2321], projectAreas: renamedAreas, corrections: [staleRule], registeredNames: namesAfterRename,
    });
    expect(areaNames(result.items)).toEqual(['Level 2 corridor', 'Level 2 corridor', 'Roof']);
  });

  it('is removed, a spelling rule is kept, and its project waits for the cloud refresh', async () => {
    const storage = memoryStorage();
    const repository = createDAVEIdentityRepository(storage);
    await repository.save(staleRule);
    await repository.save(spellingAlias('Pump Hse', 'Pump House', '2026-09-30T12:01:00.000Z'));
    const result = await runDAVEIdentityAliasCleanup({ registeredNames: namesAfterRename, repository, storage });
    expect(result.removed.map(item => item.rawName)).toEqual(['Level 2 corridor']);
    expect((await repository.list()).map(item => item.rawName)).toEqual(['Pump Hse']);
    expect(result.awaitingScheduleRefresh).toEqual([
      { kind: 'area', rawName: 'Level 2 corridor', canonicalName: 'Roof', parentProjectName: P2321 },
    ]);
    const phone = [task('t1', 'Roof'), task('t9', 'North Lot', 'Other Project')];
    expect(scheduleItemsSafeForFullSync(phone, result.awaitingScheduleRefresh).map(item => item.id)).toEqual(['t9']);
  });

  it('runs once more on a phone that already ran the first cleanup, keeping its pending refresh', async () => {
    const earlier = { kind: 'project', rawName: P2321, canonicalName: P2375, parentProjectName: null };
    const storage = memoryStorage({
      [DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY]: JSON.stringify({
        version: 1, completedAt: '2026-09-30T13:00:00.000Z', removedCount: 1, awaitingScheduleRefresh: [earlier],
      }),
    });
    const repository = createDAVEIdentityRepository(storage);
    await repository.save(staleRule);
    const rerun = await runDAVEIdentityAliasCleanup({ registeredNames: namesAfterRename, repository, storage });
    expect(rerun.alreadyDone).toBe(false);
    expect(rerun.removed.map(item => item.rawName)).toEqual(['Level 2 corridor']);
    expect(await repository.list()).toEqual([]);
    expect(rerun.awaitingScheduleRefresh.map(item => item.rawName)).toEqual([P2321, 'Level 2 corridor']);
    const marker = JSON.parse(storage.values.get(DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY)!);
    expect(marker).toMatchObject({ version: 2, removedCount: 2 });

    // Once per version: a later run changes nothing.
    await repository.save(staleRule);
    const again = await runDAVEIdentityAliasCleanup({ registeredNames: namesAfterRename, repository, storage });
    expect(again.alreadyDone).toBe(true);
    expect(again.awaitingScheduleRefresh).toHaveLength(2);
    await markDAVEIdentityAliasCleanupScheduleRefreshed(storage);
    expect(JSON.parse(storage.values.get(DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY)!))
      .toMatchObject({ version: 2, awaitingScheduleRefresh: [] });
  });
});
