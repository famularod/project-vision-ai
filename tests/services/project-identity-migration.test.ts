import {
  PROJECT_IDENTITY_MIGRATION_JOURNAL_KEY,
  createProjectIdentityMigrationService,
  type ProjectIdentityMigrationDomain,
  type ProjectIdentityMigrationStorage,
} from '../../services/ProjectIdentityMigration';

const CLOUD_ID = '11111111-1111-4111-8111-111111111111';
const RENAMED_ID = '22222222-2222-4222-8222-222222222222';
const LOCAL_SLASH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOCAL_DASH_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOCAL_UNICODE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROJECTS_KEY = 'local/projects';
const UPDATES_KEY = 'local/updates';
const DRAFT_KEY = 'local/draft';

const PROJECT_DOMAIN: ProjectIdentityMigrationDomain = {
  kind: 'projects',
  domainName: 'projects',
  storageKey: PROJECTS_KEY,
};

const UPDATE_DOMAIN: ProjectIdentityMigrationDomain = {
  kind: 'references',
  domainName: 'updates',
  storageKey: UPDATES_KEY,
  recordShape: 'array',
};

const DRAFT_DOMAIN: ProjectIdentityMigrationDomain = {
  kind: 'references',
  domainName: 'active_draft',
  storageKey: DRAFT_KEY,
  recordShape: 'single',
  recordsPath: ['draft'],
};

class MemoryMigrationStorage implements ProjectIdentityMigrationStorage {
  readonly data = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];
  readonly removedKeys: string[] = [];
  readonly journalStates: string[] = [];
  private readonly failingWrites = new Map<string, number>();

  constructor(seed: Record<string, unknown> = {}) {
    Object.entries(seed).forEach(([key, value]) => {
      this.data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    });
  }

  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    const failuresRemaining = this.failingWrites.get(key) || 0;
    if (failuresRemaining > 0) {
      this.failingWrites.set(key, failuresRemaining - 1);
      throw new Error(`Injected write failure for ${key}`);
    }
    this.data.set(key, value);
    this.writes.push({ key, value });
    if (key === PROJECT_IDENTITY_MIGRATION_JOURNAL_KEY) {
      this.journalStates.push((JSON.parse(value) as { state: string }).state);
    }
  }

  failNextWrites(key: string, count = 1) {
    this.failingWrites.set(key, count);
  }

  async removeItem(key: string) {
    this.removedKeys.push(key);
    this.data.delete(key);
  }

  writesFor(key: string) {
    return this.writes.filter(write => write.key === key);
  }
}

function clock() {
  let tick = 0;
  return () => {
    const value = new Date(Date.UTC(2026, 6, 18, 12, 0, tick));
    tick += 1;
    return value.toISOString();
  };
}

function uuidSequence(values: string[]) {
  const remaining = [...values];
  const generator = jest.fn(() => {
    const value = remaining.shift();
    if (!value) throw new Error('UUID sequence exhausted');
    return value;
  });
  return generator;
}

function service(
  storage: MemoryMigrationStorage,
  randomUUID = uuidSequence([LOCAL_SLASH_ID]),
) {
  return createProjectIdentityMigrationService({
    storage,
    randomUUID,
    now: clock(),
  });
}

function parseStored<T>(storage: MemoryMigrationStorage, key: string): T {
  const value = storage.data.get(key);
  if (!value) throw new Error(`Missing test storage key ${key}`);
  return JSON.parse(value) as T;
}

describe('ProjectIdentityMigration', () => {
  it('reconciles cloud UUIDs before generating local IDs and preserves exact names and renames', async () => {
    const storage = new MemoryMigrationStorage({
      [PROJECTS_KEY]: [
        { name: 'Cloud Linked' },
        { id: RENAMED_ID, name: 'Renamed Site' },
        'Site A/B',
        'Site A-B',
        '現場 2375',
      ],
      [UPDATES_KEY]: [
        { id: 'update-cloud', projectName: 'Cloud Linked' },
        { id: 'update-old-name', projectName: 'Original Site' },
        { id: 'update-slash', projectName: 'Site A/B' },
        { id: 'update-dash', projectName: 'Site A-B' },
        { id: 'update-unicode', projectName: '現場 2375' },
        { id: 'update-unknown', projectName: 'Unknown Project', notes: 'keep me' },
      ],
      [DRAFT_KEY]: {
        draft: { id: 'draft-1', projectName: 'Unknown Draft Project', notes: 'unchanged' },
        savedAt: '2026-07-18T11:00:00.000Z',
      },
    });
    const randomUUID = uuidSequence([
      LOCAL_SLASH_ID,
      LOCAL_DASH_ID,
      LOCAL_UNICODE_ID,
    ]);
    const migration = service(storage, randomUUID);

    const journal = await migration.run({
      domains: [PROJECT_DOMAIN, UPDATE_DOMAIN, DRAFT_DOMAIN],
      cloudProjects: [
        { id: CLOUD_ID, name: 'Cloud Linked' },
        { id: RENAMED_ID, name: 'Original Site' },
      ],
    });

    expect(journal.state).toBe('committed');
    expect(randomUUID).toHaveBeenCalledTimes(3);
    const projects = parseStored<Array<{ id: string; name: string }>>(
      storage,
      PROJECTS_KEY,
    );
    expect(projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: CLOUD_ID, name: 'Cloud Linked' }),
      expect.objectContaining({ id: RENAMED_ID, name: 'Renamed Site' }),
      { id: LOCAL_SLASH_ID, name: 'Site A/B' },
      { id: LOCAL_DASH_ID, name: 'Site A-B' },
      { id: LOCAL_UNICODE_ID, name: '現場 2375' },
    ]));
    expect(new Set(projects.map(project => project.id)).size).toBe(5);

    const updates = parseStored<Array<Record<string, unknown>>>(storage, UPDATES_KEY);
    expect(updates.find(update => update.id === 'update-cloud')?.projectId).toBe(CLOUD_ID);
    expect(updates.find(update => update.id === 'update-old-name')?.projectId).toBe(RENAMED_ID);
    expect(updates.find(update => update.id === 'update-slash')?.projectId).toBe(LOCAL_SLASH_ID);
    expect(updates.find(update => update.id === 'update-dash')?.projectId).toBe(LOCAL_DASH_ID);
    expect(updates.find(update => update.id === 'update-unicode')?.projectId).toBe(LOCAL_UNICODE_ID);
    expect(updates.find(update => update.id === 'update-unknown')).toEqual({
      id: 'update-unknown',
      projectName: 'Unknown Project',
      notes: 'keep me',
    });
    expect(parseStored(storage, DRAFT_KEY)).toEqual({
      draft: {
        id: 'draft-1',
        projectName: 'Unknown Draft Project',
        notes: 'unchanged',
      },
      savedAt: '2026-07-18T11:00:00.000Z',
    });

    expect(journal.quarantinedReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        domainName: 'updates',
        reason: 'unknown_project_name',
        originalRecord: expect.objectContaining({ id: 'update-unknown' }),
      }),
      expect.objectContaining({
        domainName: 'active_draft',
        reason: 'unknown_project_name',
        originalRecord: expect.objectContaining({ id: 'draft-1' }),
      }),
    ]));
    expect(journal.mappings.find(mapping => mapping.projectId === RENAMED_ID)).toEqual(
      expect.objectContaining({
        projectName: 'Renamed Site',
        aliases: ['Renamed Site', 'Original Site'],
        source: 'cloud_id',
      }),
    );
    expect(journal.inputInventories).toHaveLength(3);
    expect(journal.outputInventories).toHaveLength(3);
    expect(journal.inputInventories.map(item => item.recordCount)).toEqual([5, 6, 1]);
    expect(journal.outputInventories.map(item => item.recordCount)).toEqual([5, 6, 1]);
    expect(journal.inputInventories.every(item => item.checksum.startsWith('fnv1a32:'))).toBe(true);
    expect(journal.outputInventories.every(item => item.checksum.startsWith('fnv1a32:'))).toBe(true);
    expect(journal.backups).toHaveLength(3);
    expect(journal.backups.every(backup => storage.data.has(backup.backupStorageKey))).toBe(true);
    expect(storage.removedKeys).toEqual([]);
  });

  it.each([
    {
      name: 'duplicate normalized names',
      projects: ['Project Alpha', ' project alpha '],
      code: 'duplicate_local_project_name',
    },
    {
      name: 'one UUID assigned to two local projects',
      projects: [
        { id: CLOUD_ID, name: 'Project Alpha' },
        { id: CLOUD_ID, name: 'Project Beta' },
      ],
      code: 'duplicate_local_project_id',
    },
  ])('aborts on $name instead of merging', async ({ projects, code }) => {
    const original = JSON.stringify(projects);
    const storage = new MemoryMigrationStorage({ [PROJECTS_KEY]: original });

    const journal = await service(storage).run({
      domains: [PROJECT_DOMAIN],
      cloudProjects: [],
    });

    expect(journal.state).toBe('failed');
    expect(journal.failure?.code).toBe(code);
    expect(storage.data.get(PROJECTS_KEY)).toBe(original);
    expect(storage.writesFor(PROJECTS_KEY)).toHaveLength(0);
    expect(storage.removedKeys).toEqual([]);
  });

  it('persists prepared, applying, and committed states across a restart', async () => {
    const storage = new MemoryMigrationStorage({
      [PROJECTS_KEY]: ['Local Project'],
      [UPDATES_KEY]: [{ id: 'update-1', projectName: 'Local Project' }],
    });
    const firstProcess = service(storage);

    const prepared = await firstProcess.prepare({
      domains: [PROJECT_DOMAIN, UPDATE_DOMAIN],
      cloudProjects: [],
    });
    expect(prepared.state).toBe('prepared');
    expect(parseStored<Array<string>>(storage, PROJECTS_KEY)).toEqual(['Local Project']);

    const restartedProcess = service(storage);
    const committed = await restartedProcess.resume();

    expect(committed.state).toBe('committed');
    expect(committed.applyAttempts).toBe(1);
    expect(storage.journalStates).toEqual(expect.arrayContaining([
      'prepared',
      'applying',
      'committed',
    ]));
    expect((await restartedProcess.readJournal())?.state).toBe('committed');
    expect(storage.removedKeys).toEqual([]);
  });

  it('records a failed write and resumes idempotently in a new process', async () => {
    const storage = new MemoryMigrationStorage({
      [PROJECTS_KEY]: ['Local Project'],
      [UPDATES_KEY]: [{ id: 'update-1', projectName: 'Local Project' }],
    });
    const options = {
      domains: [PROJECT_DOMAIN, UPDATE_DOMAIN],
      cloudProjects: [],
    } as const;
    const firstProcess = service(storage);
    await firstProcess.prepare(options);
    const originalUpdates = storage.data.get(UPDATES_KEY);
    storage.failNextWrites(UPDATES_KEY);

    const failed = await firstProcess.resume();

    expect(failed.state).toBe('failed');
    expect(failed.failure).toEqual(expect.objectContaining({
      code: 'domain_write_failed',
      domainName: 'updates',
      resumeAllowed: true,
    }));
    expect(failed.appliedDomains).toEqual(['projects']);
    expect(storage.data.get(UPDATES_KEY)).toBe(originalUpdates);
    expect(storage.journalStates).toContain('failed');

    const restartedProcess = service(storage);
    const committed = await restartedProcess.run(options);

    expect(committed.state).toBe('committed');
    expect(committed.applyAttempts).toBe(2);
    expect(parseStored<Array<{ projectId?: string }>>(storage, UPDATES_KEY)[0].projectId).toBe(
      LOCAL_SLASH_ID,
    );
    expect(storage.removedKeys).toEqual([]);
  });

  it('fails closed when a prepared source changes and does not partially apply', async () => {
    const originalProjects = ['Local Project'];
    const storage = new MemoryMigrationStorage({
      [PROJECTS_KEY]: originalProjects,
      [UPDATES_KEY]: [{ id: 'update-1', projectName: 'Local Project' }],
    });
    const migration = service(storage);
    await migration.prepare({
      domains: [PROJECT_DOMAIN, UPDATE_DOMAIN],
      cloudProjects: [],
    });
    const changedUpdates = JSON.stringify([
      { id: 'update-2', projectName: 'Added After Prepare' },
    ]);
    storage.data.set(UPDATES_KEY, changedUpdates);

    const failed = await migration.resume();

    expect(failed.state).toBe('failed');
    expect(failed.failure).toEqual(expect.objectContaining({
      code: 'source_changed_after_prepare',
      resumeAllowed: false,
    }));
    expect(parseStored(storage, PROJECTS_KEY)).toEqual(originalProjects);
    expect(storage.data.get(UPDATES_KEY)).toBe(changedUpdates);
    expect(storage.writesFor(PROJECTS_KEY)).toHaveLength(0);
    expect(storage.removedKeys).toEqual([]);
  });

  it('recognizes an already-written prepared output and does not duplicate the write', async () => {
    const storage = new MemoryMigrationStorage({
      [PROJECTS_KEY]: ['Local Project'],
    });
    const firstProcess = service(storage);
    const prepared = await firstProcess.prepare({
      domains: [PROJECT_DOMAIN],
      cloudProjects: [],
    });
    const projectPlan = prepared.plan[0];

    await storage.setItem(PROJECTS_KEY, projectPlan.outputRaw);
    expect(storage.writesFor(PROJECTS_KEY)).toHaveLength(1);

    const restartedProcess = service(storage);
    const committed = await restartedProcess.resume();

    expect(committed.state).toBe('committed');
    expect(storage.writesFor(PROJECTS_KEY)).toHaveLength(1);
    expect(committed.appliedDomains).toEqual(['projects']);
    expect(storage.removedKeys).toEqual([]);
  });

  it('does not overwrite an unreadable existing journal', async () => {
    const storage = new MemoryMigrationStorage({
      [PROJECTS_KEY]: ['Local Project'],
      [PROJECT_IDENTITY_MIGRATION_JOURNAL_KEY]: '{not-json',
    });
    const originalJournal = storage.data.get(PROJECT_IDENTITY_MIGRATION_JOURNAL_KEY);

    await expect(service(storage).run({
      domains: [PROJECT_DOMAIN],
      cloudProjects: [],
    })).rejects.toThrow(/journal is unreadable/i);

    expect(storage.data.get(PROJECT_IDENTITY_MIGRATION_JOURNAL_KEY)).toBe(originalJournal);
    expect(storage.writesFor(PROJECTS_KEY)).toHaveLength(0);
    expect(storage.removedKeys).toEqual([]);
  });
});
