import {
  isProjectId,
  requireProjectId,
  type ProjectId,
} from './ProjectIdentity';

export const PROJECT_IDENTITY_MIGRATION_VERSION =
  'project-identity-migration/1.0' as const;
export const PROJECT_IDENTITY_MIGRATION_JOURNAL_KEY =
  '@dave/project-identity-migration/v1/journal';

export type ProjectIdentityMigrationStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export type ProjectIdentityMigrationDependencies = {
  storage: ProjectIdentityMigrationStorage;
  randomUUID: () => string;
  now: () => string;
  journalStorageKey?: string;
};

export type ProjectIdentityMigrationPath = readonly string[];

export type ProjectIdentityMigrationProjectDomain = {
  kind: 'projects';
  domainName: string;
  storageKey: string;
  recordsPath?: ProjectIdentityMigrationPath;
};

export type ProjectIdentityMigrationReferenceDomain = {
  kind: 'references';
  domainName: string;
  storageKey: string;
  recordShape: 'array' | 'single';
  recordsPath?: ProjectIdentityMigrationPath;
  projectNamePath?: ProjectIdentityMigrationPath;
  projectIdPath?: ProjectIdentityMigrationPath;
};

export type ProjectIdentityMigrationDomain =
  | ProjectIdentityMigrationProjectDomain
  | ProjectIdentityMigrationReferenceDomain;

export type ProjectIdentityMigrationCloudProject = {
  id: string;
  name: string;
};

export type ProjectIdentityMigrationOptions = {
  domains: readonly ProjectIdentityMigrationDomain[];
  cloudProjects: readonly ProjectIdentityMigrationCloudProject[];
};

export type ProjectIdentityMigrationJournalState =
  | 'prepared'
  | 'applying'
  | 'committed'
  | 'failed';

export type ProjectIdentityMigrationInventory = {
  domainName: string;
  storageKey: string;
  recordCount: number;
  byteCount: number;
  checksum: string;
};

export type ProjectIdentityMigrationBackupMetadata = {
  domainName: string;
  sourceStorageKey: string;
  backupStorageKey: string;
  sourceWasMissing: boolean;
  sourceChecksum: string;
  backupChecksum: string;
  byteCount: number;
  createdAt: string;
};

export type ProjectIdentityMigrationMapping = {
  projectId: ProjectId;
  projectName: string;
  aliases: string[];
  source: 'cloud_id' | 'cloud_name' | 'existing_local' | 'generated_local';
};

export type ProjectIdentityMigrationQuarantineReason =
  | 'missing_project_reference'
  | 'unknown_project_name'
  | 'ambiguous_project_name'
  | 'unknown_project_id';

export type ProjectIdentityMigrationQuarantineRecord = {
  domainName: string;
  storageKey: string;
  recordIndex: number;
  reason: ProjectIdentityMigrationQuarantineReason;
  projectName: string | null;
  projectId: string | null;
  recordChecksum: string;
  originalRecord: unknown;
};

export type ProjectIdentityMigrationFailure = {
  code: string;
  stage: 'prepare' | 'backup' | 'apply' | 'verify';
  message: string;
  domainName: string | null;
  failedAt: string;
  resumeAllowed: boolean;
};

export type ProjectIdentityMigrationDomainPlan = {
  domain: ProjectIdentityMigrationDomain;
  inputRaw: string | null;
  outputRaw: string;
  inputInventory: ProjectIdentityMigrationInventory;
  outputInventory: ProjectIdentityMigrationInventory;
};

export type ProjectIdentityMigrationJournal = {
  version: typeof PROJECT_IDENTITY_MIGRATION_VERSION;
  migrationId: string;
  state: ProjectIdentityMigrationJournalState;
  createdAt: string;
  updatedAt: string;
  applyAttempts: number;
  inputInventories: ProjectIdentityMigrationInventory[];
  outputInventories: ProjectIdentityMigrationInventory[];
  cloudInventory: ProjectIdentityMigrationInventory;
  backups: ProjectIdentityMigrationBackupMetadata[];
  mappings: ProjectIdentityMigrationMapping[];
  quarantinedReferences: ProjectIdentityMigrationQuarantineRecord[];
  plan: ProjectIdentityMigrationDomainPlan[];
  appliedDomains: string[];
  failure: ProjectIdentityMigrationFailure | null;
};

export type ProjectIdentityMigrationService = {
  readJournal: () => Promise<ProjectIdentityMigrationJournal | null>;
  prepare: (
    options: ProjectIdentityMigrationOptions,
  ) => Promise<ProjectIdentityMigrationJournal>;
  resume: () => Promise<ProjectIdentityMigrationJournal>;
  run: (
    options: ProjectIdentityMigrationOptions,
  ) => Promise<ProjectIdentityMigrationJournal>;
};

type ParsedDomain = {
  domain: ProjectIdentityMigrationDomain;
  root: unknown;
  records: unknown[];
  inputRaw: string | null;
  inputInventory: ProjectIdentityMigrationInventory;
};

type PreparedPlan = {
  domainPlans: ProjectIdentityMigrationDomainPlan[];
  mappings: ProjectIdentityMigrationMapping[];
  quarantinedReferences: ProjectIdentityMigrationQuarantineRecord[];
  cloudInventory: ProjectIdentityMigrationInventory;
};

class ProjectIdentityMigrationError extends Error {
  readonly code: string;
  readonly stage: ProjectIdentityMigrationFailure['stage'];
  readonly domainName: string | null;
  readonly resumeAllowed: boolean;

  constructor({
    code,
    stage,
    message,
    domainName = null,
    resumeAllowed = false,
  }: {
    code: string;
    stage: ProjectIdentityMigrationFailure['stage'];
    message: string;
    domainName?: string | null;
    resumeAllowed?: boolean;
  }) {
    super(message);
    this.name = 'ProjectIdentityMigrationError';
    this.code = code;
    this.stage = stage;
    this.domainName = domainName;
    this.resumeAllowed = resumeAllowed;
  }
}

export function createProjectIdentityMigrationService(
  dependencies: ProjectIdentityMigrationDependencies,
): ProjectIdentityMigrationService {
  const journalStorageKey =
    dependencies.journalStorageKey || PROJECT_IDENTITY_MIGRATION_JOURNAL_KEY;

  async function readJournal(): Promise<ProjectIdentityMigrationJournal | null> {
    const raw = await dependencies.storage.getItem(journalStorageKey);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as ProjectIdentityMigrationJournal;
      if (
        !parsed ||
        parsed.version !== PROJECT_IDENTITY_MIGRATION_VERSION ||
        !isJournalState(parsed.state) ||
        !Array.isArray(parsed.plan) ||
        !Array.isArray(parsed.appliedDomains)
      ) {
        throw new Error('invalid journal shape');
      }
      return parsed;
    } catch {
      throw migrationError(
        'journal_invalid',
        'verify',
        'The immutable project identity journal is unreadable; it was not replaced.',
      );
    }
  }

  async function writeJournal(
    journal: ProjectIdentityMigrationJournal,
  ): Promise<ProjectIdentityMigrationJournal> {
    await dependencies.storage.setItem(
      journalStorageKey,
      JSON.stringify(journal),
    );
    return journal;
  }

  async function prepare(
    options: ProjectIdentityMigrationOptions,
  ): Promise<ProjectIdentityMigrationJournal> {
    const existing = await readJournal();
    if (existing) return existing;

    const createdAt = requireTimestamp(dependencies.now());
    const migrationId = migrationIdentifier(createdAt);
    let preparedPlan: PreparedPlan | null = null;
    let parsedDomains: ParsedDomain[] = [];
    let backups: ProjectIdentityMigrationBackupMetadata[] = [];

    try {
      validateDomainDefinitions(options.domains);
      parsedDomains = await readAndParseDomains(
        dependencies.storage,
        options.domains,
      );
      preparedPlan = buildPreparedPlan({
        parsedDomains,
        cloudProjects: options.cloudProjects,
        randomUUID: dependencies.randomUUID,
      });
      backups = await writeVerifiedBackups({
        storage: dependencies.storage,
        migrationId,
        createdAt,
        plans: preparedPlan.domainPlans,
      });

      return writeJournal({
        version: PROJECT_IDENTITY_MIGRATION_VERSION,
        migrationId,
        state: 'prepared',
        createdAt,
        updatedAt: createdAt,
        applyAttempts: 0,
        inputInventories: preparedPlan.domainPlans.map(
          plan => plan.inputInventory,
        ),
        outputInventories: preparedPlan.domainPlans.map(
          plan => plan.outputInventory,
        ),
        cloudInventory: preparedPlan.cloudInventory,
        backups,
        mappings: preparedPlan.mappings,
        quarantinedReferences: preparedPlan.quarantinedReferences,
        plan: preparedPlan.domainPlans,
        appliedDomains: [],
        failure: null,
      });
    } catch (error) {
      const failure = failureFromError(error, dependencies.now(),
        preparedPlan ? 'backup' : 'prepare');
      const failedJournal: ProjectIdentityMigrationJournal = {
        version: PROJECT_IDENTITY_MIGRATION_VERSION,
        migrationId,
        state: 'failed',
        createdAt,
        updatedAt: failure.failedAt,
        applyAttempts: 0,
        inputInventories: preparedPlan?.domainPlans.map(
          plan => plan.inputInventory,
        ) || parsedDomains.map(domain => domain.inputInventory),
        outputInventories: preparedPlan?.domainPlans.map(
          plan => plan.outputInventory,
        ) || [],
        cloudInventory: preparedPlan?.cloudInventory || inventoryForRaw({
          domainName: 'cloud_projects',
          storageKey: 'cloud://projects',
          raw: JSON.stringify(options.cloudProjects),
          recordCount: options.cloudProjects.length,
        }),
        backups,
        mappings: preparedPlan?.mappings || [],
        quarantinedReferences: preparedPlan?.quarantinedReferences || [],
        plan: preparedPlan?.domainPlans || [],
        appliedDomains: [],
        failure: {
          ...failure,
          resumeAllowed: false,
        },
      };
      return writeJournal(failedJournal);
    }
  }

  async function resume(): Promise<ProjectIdentityMigrationJournal> {
    let journal = await readJournal();
    if (!journal) {
      throw migrationError(
        'journal_missing',
        'apply',
        'No prepared immutable project identity migration exists.',
      );
    }

    if (journal.state === 'committed') {
      return verifyCommittedJournal(journal, dependencies.storage, writeJournal,
        dependencies.now);
    }
    if (
      journal.state === 'failed' &&
      (!journal.failure?.resumeAllowed || journal.plan.length === 0)
    ) {
      return journal;
    }

    journal = await writeJournal({
      ...journal,
      state: 'applying',
      updatedAt: requireTimestamp(dependencies.now()),
      applyAttempts: journal.applyAttempts + 1,
      failure: null,
    });

    try {
      for (const plan of journal.plan) {
        await verifyBackup(dependencies.storage, journal, plan);
        const currentRaw = await dependencies.storage.getItem(
          plan.domain.storageKey,
        );
        const currentChecksum = checksumStorageValue(currentRaw);
        if (journal.appliedDomains.includes(plan.domain.domainName)) {
          if (currentChecksum !== plan.outputInventory.checksum) {
            throw migrationError(
              'applied_output_changed',
              'verify',
              `The applied ${plan.domain.domainName} output changed before commit.`,
              plan.domain.domainName,
            );
          }
        } else if (
          currentChecksum !== plan.inputInventory.checksum &&
          currentChecksum !== plan.outputInventory.checksum
        ) {
          throw migrationError(
            'source_changed_after_prepare',
            'apply',
            `The ${plan.domain.domainName} source changed after preparation; it was not overwritten.`,
            plan.domain.domainName,
          );
        }
      }

      for (const plan of journal.plan) {
        if (journal.appliedDomains.includes(plan.domain.domainName)) {
          await verifyAppliedOutput(dependencies.storage, plan);
          continue;
        }

        await verifyBackup(dependencies.storage, journal, plan);
        const currentRaw = await dependencies.storage.getItem(
          plan.domain.storageKey,
        );
        const currentChecksum = checksumStorageValue(currentRaw);

        if (currentChecksum !== plan.outputInventory.checksum) {
          if (currentChecksum !== plan.inputInventory.checksum) {
            throw migrationError(
              'source_changed_after_prepare',
              'apply',
              `The ${plan.domain.domainName} source changed after preparation; it was not overwritten.`,
              plan.domain.domainName,
            );
          }
          try {
            await dependencies.storage.setItem(
              plan.domain.storageKey,
              plan.outputRaw,
            );
          } catch {
            throw migrationError(
              'domain_write_failed',
              'apply',
              `The ${plan.domain.domainName} output could not be written.`,
              plan.domain.domainName,
              true,
            );
          }
        }

        await verifyAppliedOutput(dependencies.storage, plan);
        journal = await writeJournal({
          ...journal,
          appliedDomains: [...journal.appliedDomains, plan.domain.domainName],
          updatedAt: requireTimestamp(dependencies.now()),
        });
      }

      for (const plan of journal.plan) {
        await verifyAppliedOutput(dependencies.storage, plan);
      }

      journal = await writeJournal({
        ...journal,
        state: 'committed',
        updatedAt: requireTimestamp(dependencies.now()),
        failure: null,
      });
      return journal;
    } catch (error) {
      const failure = failureFromError(error, dependencies.now(), 'apply');
      return writeJournal({
        ...journal,
        state: 'failed',
        updatedAt: failure.failedAt,
        failure,
      });
    }
  }

  async function run(
    options: ProjectIdentityMigrationOptions,
  ): Promise<ProjectIdentityMigrationJournal> {
    const existing = await readJournal();
    const journal = existing || await prepare(options);
    if (journal.state === 'committed') return resume();
    if (
      journal.state === 'failed' &&
      (!journal.failure?.resumeAllowed || journal.plan.length === 0)
    ) {
      return journal;
    }
    return resume();
  }

  return { readJournal, prepare, resume, run };
}

function buildPreparedPlan({
  parsedDomains,
  cloudProjects,
  randomUUID,
}: {
  parsedDomains: ParsedDomain[];
  cloudProjects: readonly ProjectIdentityMigrationCloudProject[];
  randomUUID: () => string;
}): PreparedPlan {
  const projectDomain = parsedDomains.find(
    candidate => candidate.domain.kind === 'projects',
  );
  if (!projectDomain) {
    throw migrationError(
      'project_domain_missing',
      'prepare',
      'Exactly one canonical project domain is required.',
    );
  }

  const registry = reconcileProjectRegistry({
    localProjects: projectDomain.records,
    cloudProjects,
    randomUUID,
  });
  const outputByDomain = new Map<string, {
    root: unknown;
    records: unknown[];
  }>();
  outputByDomain.set(projectDomain.domain.domainName, {
    root: replaceDomainRecords(
      projectDomain.root,
      projectDomain.domain.recordsPath,
      registry.outputProjects,
    ),
    records: registry.outputProjects,
  });

  const quarantinedReferences: ProjectIdentityMigrationQuarantineRecord[] = [];
  for (const parsed of parsedDomains) {
    if (parsed.domain.kind !== 'references') continue;
    const migrated = migrateReferenceRecords({
      domain: parsed.domain,
      records: parsed.records,
      resolver: registry.resolver,
      knownProjectIds: registry.knownProjectIds,
    });
    quarantinedReferences.push(...migrated.quarantinedReferences);
    const replacement = parsed.domain.recordShape === 'single'
      ? migrated.records[0] ?? null
      : migrated.records;
    outputByDomain.set(parsed.domain.domainName, {
      root: replaceDomainRecords(
        parsed.root,
        parsed.domain.recordsPath,
        replacement,
      ),
      records: migrated.records,
    });
  }

  const domainPlans = parsedDomains.map(parsed => {
    const output = outputByDomain.get(parsed.domain.domainName);
    if (!output) {
      throw migrationError(
        'domain_output_missing',
        'prepare',
        `No output was prepared for ${parsed.domain.domainName}.`,
        parsed.domain.domainName,
      );
    }
    const outputRaw = JSON.stringify(output.root);
    return {
      domain: parsed.domain,
      inputRaw: parsed.inputRaw,
      outputRaw,
      inputInventory: parsed.inputInventory,
      outputInventory: inventoryForRaw({
        domainName: parsed.domain.domainName,
        storageKey: parsed.domain.storageKey,
        raw: outputRaw,
        recordCount: output.records.length,
      }),
    };
  });

  return {
    domainPlans,
    mappings: registry.mappings,
    quarantinedReferences,
    cloudInventory: inventoryForRaw({
      domainName: 'cloud_projects',
      storageKey: 'cloud://projects',
      raw: JSON.stringify(cloudProjects),
      recordCount: cloudProjects.length,
    }),
  };
}

function reconcileProjectRegistry({
  localProjects,
  cloudProjects,
  randomUUID,
}: {
  localProjects: unknown[];
  cloudProjects: readonly ProjectIdentityMigrationCloudProject[];
  randomUUID: () => string;
}) {
  const cloudById = new Map<ProjectId, ProjectIdentityMigrationCloudProject>();
  const cloudByName = new Map<string, ProjectIdentityMigrationCloudProject>();
  for (const cloud of cloudProjects) {
    const name = requireProjectName(cloud.name, 'cloud project');
    if (!isProjectId(cloud.id)) {
      throw migrationError(
        'invalid_cloud_project_id',
        'prepare',
        `Cloud project “${name}” does not have a valid UUID identity.`,
      );
    }
    const id = requireProjectId(cloud.id);
    const nameKey = projectNameKey(name);
    const sameId = cloudById.get(id);
    if (sameId) {
      throw migrationError(
        'duplicate_cloud_project_id',
        'prepare',
        'One cloud project UUID is assigned to multiple project names.',
      );
    }
    const sameName = cloudByName.get(nameKey);
    if (sameName) {
      throw migrationError(
        'duplicate_cloud_project_name',
        'prepare',
        `Cloud project name “${name}” resolves to multiple UUIDs.`,
      );
    }
    cloudById.set(id, { ...cloud, id, name });
    cloudByName.set(nameKey, { ...cloud, id, name });
  }

  const localNames = new Set<string>();
  const outputProjects: unknown[] = [];
  const mappings: ProjectIdentityMigrationMapping[] = [];
  const assignedIds = new Set<ProjectId>();

  for (const rawProject of localProjects) {
    const normalized = normalizeLocalProject(rawProject);
    const nameKey = projectNameKey(normalized.name);
    if (localNames.has(nameKey)) {
      throw migrationError(
        'duplicate_local_project_name',
        'prepare',
        `Local project name “${normalized.name}” appears more than once.`,
      );
    }
    localNames.add(nameKey);

    const explicitId = validOptionalProjectId(normalized.id);
    const cloudProjectId = validOptionalProjectId(normalized.cloudProjectId);
    if (explicitId && cloudProjectId && explicitId !== cloudProjectId) {
      throw migrationError(
        'conflicting_local_project_ids',
        'prepare',
        `Local project “${normalized.name}” contains conflicting UUIDs.`,
      );
    }

    const suppliedId = cloudProjectId || explicitId;
    const cloudBySuppliedId = suppliedId ? cloudById.get(suppliedId) : undefined;
    const cloudByCurrentName = cloudByName.get(nameKey);
    if (
      suppliedId &&
      cloudByCurrentName &&
      requireProjectId(cloudByCurrentName.id) !== suppliedId
    ) {
      throw migrationError(
        'local_cloud_identity_conflict',
        'prepare',
        `Local project “${normalized.name}” conflicts with the cloud UUID for that name.`,
      );
    }

    let projectId: ProjectId;
    let source: ProjectIdentityMigrationMapping['source'];
    if (suppliedId) {
      projectId = suppliedId;
      source = cloudBySuppliedId ? 'cloud_id' : 'existing_local';
    } else if (cloudByCurrentName) {
      projectId = requireProjectId(cloudByCurrentName.id);
      source = 'cloud_name';
    } else {
      let generated: string;
      try {
        generated = randomUUID();
      } catch {
        throw migrationError(
          'uuid_generation_failed',
          'prepare',
          `A UUID could not be generated for local project “${normalized.name}”.`,
        );
      }
      if (!isProjectId(generated)) {
        throw migrationError(
          'invalid_generated_project_id',
          'prepare',
          'The configured Expo Crypto UUID generator returned an invalid UUIDv4.',
        );
      }
      projectId = requireProjectId(generated);
      source = 'generated_local';
    }

    if (assignedIds.has(projectId)) {
      throw migrationError(
        'duplicate_local_project_id',
        'prepare',
        'One immutable project UUID would be assigned to multiple local projects.',
      );
    }
    if (
      source === 'generated_local' &&
      (cloudById.has(projectId) || assignedIds.has(projectId))
    ) {
      throw migrationError(
        'generated_project_id_collision',
        'prepare',
        'The generated project UUID conflicts with an existing project UUID.',
      );
    }
    assignedIds.add(projectId);

    const aliases = uniqueProjectNames([
      normalized.name,
      cloudBySuppliedId?.name,
      cloudByCurrentName?.name,
    ]);
    mappings.push({
      projectId,
      projectName: normalized.name,
      aliases,
      source,
    });
    outputProjects.push(projectOutputRecord(normalized, projectId));
  }

  const resolver = new Map<string, Set<ProjectId>>();
  const knownProjectIds = new Set<ProjectId>(cloudById.keys());
  for (const mapping of mappings) {
    knownProjectIds.add(mapping.projectId);
    for (const alias of mapping.aliases) {
      addNameResolution(resolver, alias, mapping.projectId);
    }
  }
  for (const cloud of cloudById.values()) {
    addNameResolution(resolver, cloud.name, requireProjectId(cloud.id));
  }

  return { outputProjects, mappings, resolver, knownProjectIds };
}

function migrateReferenceRecords({
  domain,
  records,
  resolver,
  knownProjectIds,
}: {
  domain: ProjectIdentityMigrationReferenceDomain;
  records: unknown[];
  resolver: Map<string, Set<ProjectId>>;
  knownProjectIds: Set<ProjectId>;
}) {
  const projectNamePath = domain.projectNamePath || ['projectName'];
  const projectIdPath = domain.projectIdPath || ['projectId'];
  const quarantinedReferences: ProjectIdentityMigrationQuarantineRecord[] = [];
  const migratedRecords = records.map((record, recordIndex) => {
    const stringRecord = typeof record === 'string';
    const projectName = optionalText(
      stringRecord ? record : getAtPath(record, projectNamePath),
    );
    const rawProjectId = optionalText(
      stringRecord ? null : getAtPath(record, projectIdPath),
    );
    const validProjectId = validOptionalProjectId(rawProjectId);
    const candidates = projectName
      ? resolver.get(projectNameKey(projectName)) || new Set<ProjectId>()
      : new Set<ProjectId>();

    if (validProjectId) {
      if (candidates.size === 1 && !candidates.has(validProjectId)) {
        throw migrationError(
          'reference_project_id_conflict',
          'prepare',
          `A ${domain.domainName} reference contains a UUID that conflicts with its project name.`,
          domain.domainName,
        );
      }
      if (candidates.size > 1) {
        quarantine('ambiguous_project_name');
        return record;
      }
      if (!knownProjectIds.has(validProjectId)) {
        quarantine('unknown_project_id');
        return record;
      }
      return stringRecord
        ? { id: validProjectId, name: projectName || '' }
        : setAtPath(record, projectIdPath, validProjectId);
    }

    if (!projectName) {
      quarantine('missing_project_reference');
      return record;
    }
    if (candidates.size === 0) {
      quarantine('unknown_project_name');
      return record;
    }
    if (candidates.size > 1) {
      quarantine('ambiguous_project_name');
      return record;
    }

    const [projectId] = candidates;
    return stringRecord
      ? { id: projectId, name: projectName }
      : setAtPath(record, projectIdPath, projectId);

    function quarantine(reason: ProjectIdentityMigrationQuarantineReason) {
      quarantinedReferences.push({
        domainName: domain.domainName,
        storageKey: domain.storageKey,
        recordIndex,
        reason,
        projectName,
        projectId: rawProjectId,
        recordChecksum: checksumStorageValue(JSON.stringify(record)),
        originalRecord: record,
      });
    }
  });

  return { records: migratedRecords, quarantinedReferences };
}

async function readAndParseDomains(
  storage: ProjectIdentityMigrationStorage,
  domains: readonly ProjectIdentityMigrationDomain[],
): Promise<ParsedDomain[]> {
  const parsedDomains: ParsedDomain[] = [];
  for (const domain of domains) {
    const inputRaw = await storage.getItem(domain.storageKey);
    const root = parseDomainRoot(domain, inputRaw);
    const records = domainRecords(domain, root);
    parsedDomains.push({
      domain,
      root,
      records,
      inputRaw,
      inputInventory: inventoryForRaw({
        domainName: domain.domainName,
        storageKey: domain.storageKey,
        raw: inputRaw,
        recordCount: records.length,
      }),
    });
  }
  return parsedDomains;
}

function parseDomainRoot(
  domain: ProjectIdentityMigrationDomain,
  raw: string | null,
): unknown {
  if (raw === null) {
    const emptyRecords = domain.kind === 'projects' || domain.recordShape === 'array'
      ? []
      : null;
    return replaceDomainRecords({}, domain.recordsPath, emptyRecords);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw migrationError(
      'domain_json_invalid',
      'prepare',
      `The ${domain.domainName} source is not valid JSON.`,
      domain.domainName,
    );
  }
}

function domainRecords(
  domain: ProjectIdentityMigrationDomain,
  root: unknown,
): unknown[] {
  const value = domain.recordsPath?.length
    ? getAtPath(root, domain.recordsPath)
    : root;
  if (domain.kind === 'projects' || domain.recordShape === 'array') {
    if (!Array.isArray(value)) {
      throw migrationError(
        'domain_records_not_array',
        'prepare',
        `The ${domain.domainName} domain must contain an array.`,
        domain.domainName,
      );
    }
    return value;
  }
  return value === null || value === undefined ? [] : [value];
}

function replaceDomainRecords(
  root: unknown,
  recordsPath: ProjectIdentityMigrationPath | undefined,
  records: unknown,
): unknown {
  if (!recordsPath?.length) return records;
  return setAtPath(root, recordsPath, records);
}

async function writeVerifiedBackups({
  storage,
  migrationId,
  createdAt,
  plans,
}: {
  storage: ProjectIdentityMigrationStorage;
  migrationId: string;
  createdAt: string;
  plans: ProjectIdentityMigrationDomainPlan[];
}): Promise<ProjectIdentityMigrationBackupMetadata[]> {
  const backups: ProjectIdentityMigrationBackupMetadata[] = [];
  for (const plan of plans) {
    const backupStorageKey =
      `@dave/project-identity-migration/v1/backups/${migrationId}/${safeKeySegment(plan.domain.domainName)}`;
    const envelope = JSON.stringify({
      version: PROJECT_IDENTITY_MIGRATION_VERSION,
      sourceStorageKey: plan.domain.storageKey,
      sourceWasMissing: plan.inputRaw === null,
      raw: plan.inputRaw,
      checksum: plan.inputInventory.checksum,
    });
    try {
      await storage.setItem(backupStorageKey, envelope);
      const verified = await storage.getItem(backupStorageKey);
      if (verified !== envelope) throw new Error('backup read-back mismatch');
    } catch {
      throw migrationError(
        'backup_write_failed',
        'backup',
        `The ${plan.domain.domainName} backup could not be verified.`,
        plan.domain.domainName,
      );
    }
    backups.push({
      domainName: plan.domain.domainName,
      sourceStorageKey: plan.domain.storageKey,
      backupStorageKey,
      sourceWasMissing: plan.inputRaw === null,
      sourceChecksum: plan.inputInventory.checksum,
      backupChecksum: checksumStorageValue(envelope),
      byteCount: utf8ByteCount(envelope),
      createdAt,
    });
  }
  return backups;
}

async function verifyBackup(
  storage: ProjectIdentityMigrationStorage,
  journal: ProjectIdentityMigrationJournal,
  plan: ProjectIdentityMigrationDomainPlan,
) {
  const metadata = journal.backups.find(
    candidate => candidate.domainName === plan.domain.domainName,
  );
  if (!metadata) {
    throw migrationError(
      'backup_metadata_missing',
      'verify',
      `Backup metadata is missing for ${plan.domain.domainName}.`,
      plan.domain.domainName,
    );
  }
  const raw = await storage.getItem(metadata.backupStorageKey);
  if (raw === null || checksumStorageValue(raw) !== metadata.backupChecksum) {
    throw migrationError(
      'backup_verification_failed',
      'verify',
      `The ${plan.domain.domainName} backup is missing or changed.`,
      plan.domain.domainName,
    );
  }
  try {
    const envelope = JSON.parse(raw) as {
      checksum?: unknown;
      raw?: unknown;
    };
    if (
      envelope.checksum !== plan.inputInventory.checksum ||
      checksumStorageValue(
        typeof envelope.raw === 'string' ? envelope.raw : null,
      ) !== plan.inputInventory.checksum
    ) {
      throw new Error('backup source mismatch');
    }
  } catch {
    throw migrationError(
      'backup_source_mismatch',
      'verify',
      `The ${plan.domain.domainName} backup does not match its inventoried source.`,
      plan.domain.domainName,
    );
  }
}

async function verifyAppliedOutput(
  storage: ProjectIdentityMigrationStorage,
  plan: ProjectIdentityMigrationDomainPlan,
) {
  const outputRaw = await storage.getItem(plan.domain.storageKey);
  if (
    outputRaw === null ||
    checksumStorageValue(outputRaw) !== plan.outputInventory.checksum
  ) {
    throw migrationError(
      'output_verification_failed',
      'verify',
      `The ${plan.domain.domainName} output does not match its prepared checksum.`,
      plan.domain.domainName,
      true,
    );
  }
  const root = parseDomainRoot(plan.domain, outputRaw);
  const records = domainRecords(plan.domain, root);
  if (records.length !== plan.outputInventory.recordCount) {
    throw migrationError(
      'output_count_mismatch',
      'verify',
      `The ${plan.domain.domainName} output record count changed.`,
      plan.domain.domainName,
      true,
    );
  }
}

async function verifyCommittedJournal(
  journal: ProjectIdentityMigrationJournal,
  storage: ProjectIdentityMigrationStorage,
  writeJournal: (
    journal: ProjectIdentityMigrationJournal,
  ) => Promise<ProjectIdentityMigrationJournal>,
  now: () => string,
) {
  try {
    for (const plan of journal.plan) {
      await verifyAppliedOutput(storage, plan);
    }
    return journal;
  } catch (error) {
    const failure = failureFromError(error, now(), 'verify');
    return writeJournal({
      ...journal,
      state: 'failed',
      updatedAt: failure.failedAt,
      failure: { ...failure, resumeAllowed: false },
    });
  }
}

function validateDomainDefinitions(
  domains: readonly ProjectIdentityMigrationDomain[],
) {
  const names = new Set<string>();
  const storageKeys = new Set<string>();
  let projectDomainCount = 0;
  for (const domain of domains) {
    if (!domain.domainName.trim() || !domain.storageKey.trim()) {
      throw migrationError(
        'domain_definition_invalid',
        'prepare',
        'Migration domain names and storage keys are required.',
      );
    }
    if (names.has(domain.domainName) || storageKeys.has(domain.storageKey)) {
      throw migrationError(
        'ambiguous_domain_definition',
        'prepare',
        'Migration domains must have unique names and storage keys.',
      );
    }
    names.add(domain.domainName);
    storageKeys.add(domain.storageKey);
    if (domain.kind === 'projects') projectDomainCount += 1;
  }
  if (projectDomainCount !== 1) {
    throw migrationError(
      'project_domain_count_invalid',
      'prepare',
      'Exactly one canonical project domain is required.',
    );
  }
}

function normalizeLocalProject(value: unknown): {
  name: string;
  id: string | null;
  cloudProjectId: string | null;
  original: Record<string, unknown> | null;
} {
  if (typeof value === 'string') {
    return {
      name: requireProjectName(value, 'local project'),
      id: null,
      cloudProjectId: null,
      original: null,
    };
  }
  if (!isRecord(value)) {
    throw migrationError(
      'local_project_invalid',
      'prepare',
      'Every local project must be a name or project record.',
    );
  }
  return {
    name: requireProjectName(value.name, 'local project'),
    id: optionalText(value.id),
    cloudProjectId: optionalText(value.cloudProjectId),
    original: value,
  };
}

function projectOutputRecord(
  project: ReturnType<typeof normalizeLocalProject>,
  projectId: ProjectId,
) {
  if (!project.original) return { id: projectId, name: project.name };
  const output: Record<string, unknown> = {
    ...project.original,
    id: projectId,
    name: project.name,
  };
  if (project.id && !isProjectId(project.id)) {
    output.legacyProjectId = project.id;
  }
  return output;
}

function validOptionalProjectId(value: unknown): ProjectId | null {
  return isProjectId(value) ? requireProjectId(value) : null;
}

function addNameResolution(
  resolver: Map<string, Set<ProjectId>>,
  name: string,
  projectId: ProjectId,
) {
  const key = projectNameKey(name);
  const ids = resolver.get(key) || new Set<ProjectId>();
  ids.add(projectId);
  resolver.set(key, ids);
}

function uniqueProjectNames(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const name = value.trim();
    const key = projectNameKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function requireProjectName(value: unknown, source: string) {
  const name = optionalText(value)?.normalize('NFC') || '';
  if (!name) {
    throw migrationError(
      'project_name_missing',
      'prepare',
      `A ${source} is missing its display name.`,
    );
  }
  return name;
}

function projectNameKey(value: string) {
  return value.trim().normalize('NFC').toLocaleLowerCase('en-US');
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getAtPath(value: unknown, path: ProjectIdentityMigrationPath): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setAtPath(
  value: unknown,
  path: ProjectIdentityMigrationPath,
  nextValue: unknown,
): unknown {
  if (path.length === 0) return nextValue;
  const [segment, ...rest] = path;
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    [segment]: setAtPath(source[segment], rest, nextValue),
  };
}

function inventoryForRaw({
  domainName,
  storageKey,
  raw,
  recordCount,
}: {
  domainName: string;
  storageKey: string;
  raw: string | null;
  recordCount: number;
}): ProjectIdentityMigrationInventory {
  const stored = storageChecksumInput(raw);
  return {
    domainName,
    storageKey,
    recordCount,
    byteCount: utf8ByteCount(stored),
    checksum: checksum(stored),
  };
}

function checksumStorageValue(value: string | null) {
  return checksum(storageChecksumInput(value));
}

function storageChecksumInput(value: string | null) {
  return value === null ? '__PROJECT_IDENTITY_STORAGE_MISSING__' : value;
}

function checksum(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function utf8ByteCount(value: string) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) || 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function migrationIdentifier(timestamp: string) {
  return `project-identity-v1-${timestamp.replace(/[^0-9a-z]/gi, '')}`;
}

function safeKeySegment(value: string) {
  return encodeURIComponent(value.trim());
}

function requireTimestamp(value: string) {
  const timestamp = optionalText(value);
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
    throw migrationError(
      'clock_invalid',
      'prepare',
      'The migration clock did not return a valid timestamp.',
    );
  }
  return timestamp;
}

function failureFromError(
  error: unknown,
  timestamp: string,
  fallbackStage: ProjectIdentityMigrationFailure['stage'],
): ProjectIdentityMigrationFailure {
  const failedAt = requireTimestamp(timestamp);
  if (error instanceof ProjectIdentityMigrationError) {
    return {
      code: error.code,
      stage: error.stage,
      message: error.message,
      domainName: error.domainName,
      failedAt,
      resumeAllowed: error.resumeAllowed,
    };
  }
  return {
    code: 'unexpected_migration_failure',
    stage: fallbackStage,
    message: 'The immutable project identity migration stopped safely.',
    domainName: null,
    failedAt,
    resumeAllowed: fallbackStage === 'apply',
  };
}

function migrationError(
  code: string,
  stage: ProjectIdentityMigrationFailure['stage'],
  message: string,
  domainName: string | null = null,
  resumeAllowed = false,
) {
  return new ProjectIdentityMigrationError({
    code,
    stage,
    message,
    domainName,
    resumeAllowed,
  });
}

function isJournalState(value: unknown): value is ProjectIdentityMigrationJournalState {
  return value === 'prepared' ||
    value === 'applying' ||
    value === 'committed' ||
    value === 'failed';
}
