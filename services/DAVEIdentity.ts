import type { ProjectArea, ScheduleItem } from '../types';

export const DAVE_IDENTITY_VERSION = 'dave-identity/1.0' as const;

export type DAVEEntityKind =
  | 'project'
  | 'area'
  | 'task'
  | 'person'
  | 'company'
  | 'asset';

export type DAVEIdentityEntity = {
  id: string;
  kind: DAVEEntityKind;
  canonicalName: string;
  normalizedName: string;
  aliases: string[];
  parentProjectName: string | null;
  sourceRecordIds: string[];
};

export type DAVEIdentityCorrection = {
  id: string;
  kind: DAVEEntityKind;
  rawName: string;
  canonicalName: string;
  parentProjectName?: string | null;
  sourceRecordId: string;
  confirmedAt: string;
  confirmedBy: string;
};

export type DAVEIdentityRegistry = {
  schemaVersion: typeof DAVE_IDENTITY_VERSION;
  entities: DAVEIdentityEntity[];
  corrections: DAVEIdentityCorrection[];
};

export type DAVEIdentityResolution = {
  status: 'resolved' | 'ambiguous' | 'unresolved' | 'kind_conflict';
  expectedKind: DAVEEntityKind;
  rawName: string;
  entity: DAVEIdentityEntity | null;
  candidates: DAVEIdentityEntity[];
  confidence: 'high' | 'medium' | 'low';
  basis: string;
  needsVerification: boolean;
};

export type DAVEScheduleIdentityIssue = {
  itemId: string;
  field: 'project' | 'area' | 'task';
  status: DAVEIdentityResolution['status'];
  rawValue: string;
  message: string;
};

export type DAVEScheduleIdentityResult = {
  items: ScheduleItem[];
  issues: DAVEScheduleIdentityIssue[];
  registry: DAVEIdentityRegistry;
};

type BuildDAVEIdentityRegistryInput = {
  projectNames: readonly string[];
  projectAreas?: readonly ProjectArea[];
  scheduleItems?: readonly ScheduleItem[];
  corrections?: readonly DAVEIdentityCorrection[];
};

export function normalizeDAVEIdentityName(value: string | null | undefined) {
  return (value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function daveIdentityNamesMatch(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const normalizedLeft = normalizeDAVEIdentityName(left);
  return Boolean(normalizedLeft && normalizedLeft === normalizeDAVEIdentityName(right));
}

export function daveIdentityEntityId(
  kind: DAVEEntityKind,
  canonicalName: string,
  parentProjectName?: string | null,
) {
  return [
    kind,
    normalizeDAVEIdentityName(parentProjectName),
    normalizeDAVEIdentityName(canonicalName),
  ].filter(Boolean).join(':');
}

export function buildDAVEIdentityRegistry(
  input: BuildDAVEIdentityRegistryInput,
): DAVEIdentityRegistry {
  const entities = new Map<string, DAVEIdentityEntity>();
  const corrections = [...(input.corrections || [])];

  function correctedIdentity(
    kind: DAVEEntityKind,
    name: string,
    parentProjectName?: string | null,
  ) {
    const rawKey = normalizeDAVEIdentityName(name);
    const parentKey = normalizeDAVEIdentityName(parentProjectName);
    const correction = corrections
      .filter(item =>
        item.kind === kind &&
        normalizeDAVEIdentityName(item.rawName) === rawKey &&
        (!item.parentProjectName || normalizeDAVEIdentityName(item.parentProjectName) === parentKey),
      )
      .sort((left, right) => right.confirmedAt.localeCompare(left.confirmedAt))[0];
    return correction
      ? { canonicalName: correction.canonicalName, aliases: [name] }
      : { canonicalName: name, aliases: [] as string[] };
  }

  function addEntity({
    kind,
    canonicalName,
    parentProjectName = null,
    aliases = [],
    sourceRecordIds = [],
  }: {
    kind: DAVEEntityKind;
    canonicalName: string;
    parentProjectName?: string | null;
    aliases?: string[];
    sourceRecordIds?: string[];
  }) {
    const cleanName = canonicalName.trim();
    const normalizedName = normalizeDAVEIdentityName(cleanName);
    if (!normalizedName) return;
    const id = daveIdentityEntityId(kind, cleanName, parentProjectName);
    const existing = entities.get(id);
    const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

    entities.set(id, {
      id,
      kind,
      canonicalName: existing?.canonicalName || cleanName,
      normalizedName,
      aliases: unique([...(existing?.aliases || []), ...aliases.map(alias => alias.trim())]),
      parentProjectName: parentProjectName?.trim() || existing?.parentProjectName || null,
      sourceRecordIds: unique([...(existing?.sourceRecordIds || []), ...sourceRecordIds]),
    });
  }

  input.projectNames.forEach(name => {
    const corrected = correctedIdentity('project', name);
    addEntity({ kind: 'project', ...corrected });
  });
  input.scheduleItems?.forEach(item => {
    [item.scheduleProjectName, item.projectName].forEach(name => {
      if (name?.trim()) {
        const corrected = correctedIdentity('project', name);
        addEntity({ kind: 'project', ...corrected });
      }
    });
    const areaName = safeScheduleAreaName(item);
    if (areaName) {
      const parentProjectName = item.scheduleProjectName || item.projectName;
      const corrected = correctedIdentity('area', areaName, parentProjectName);
      addEntity({
        kind: 'area',
        ...corrected,
        parentProjectName,
        sourceRecordIds: [item.id],
      });
    }
    const correctedTask = correctedIdentity(
      'task',
      item.taskName,
      item.scheduleProjectName || item.projectName,
    );
    addEntity({
      kind: 'task',
      ...correctedTask,
      parentProjectName: item.scheduleProjectName || item.projectName,
      sourceRecordIds: [item.id],
    });
  });
  input.projectAreas?.forEach(area => {
    const corrected = correctedIdentity('area', area.name);
    addEntity({
      kind: 'area',
      ...corrected,
      sourceRecordIds: [area.id],
    });
  });
  corrections.forEach(correction => addEntity({
    kind: correction.kind,
    canonicalName: correction.canonicalName,
    parentProjectName: correction.parentProjectName,
    aliases: [correction.rawName],
    sourceRecordIds: [correction.sourceRecordId],
  }));

  return {
    schemaVersion: DAVE_IDENTITY_VERSION,
    entities: Array.from(entities.values()),
    corrections,
  };
}

export function resolveDAVEIdentity({
  rawName,
  expectedKind,
  registry,
  parentProjectName = null,
}: {
  rawName: string | null | undefined;
  expectedKind: DAVEEntityKind;
  registry: DAVEIdentityRegistry;
  parentProjectName?: string | null;
}): DAVEIdentityResolution {
  const cleanName = (rawName || '').trim();
  const normalizedName = normalizeDAVEIdentityName(cleanName);
  if (!normalizedName) {
    return resolution('unresolved', expectedKind, cleanName, [], 'No identity was provided.');
  }

  const parentKey = normalizeDAVEIdentityName(parentProjectName);
  const nameMatches = registry.entities.filter(entity =>
    entity.normalizedName === normalizedName ||
    entity.aliases.some(alias => normalizeDAVEIdentityName(alias) === normalizedName),
  );
  const kindMatches = nameMatches.filter(entity => entity.kind === expectedKind);
  const exactParentMatches = parentKey
    ? kindMatches.filter(entity =>
        normalizeDAVEIdentityName(entity.parentProjectName) === parentKey,
      )
    : [];
  const unscopedMatches = kindMatches.filter(entity => !entity.parentProjectName);
  const candidates = exactParentMatches.length > 0
    ? exactParentMatches
    : unscopedMatches.length > 0
      ? unscopedMatches
      : kindMatches;

  if (candidates.length === 1) {
    return {
      status: 'resolved',
      expectedKind,
      rawName: cleanName,
      entity: candidates[0],
      candidates,
      confidence: 'high',
      basis: candidates[0].normalizedName === normalizedName
        ? 'Exact canonical identity match.'
        : 'PM-confirmed identity alias match.',
      needsVerification: false,
    };
  }
  if (candidates.length > 1) {
    return resolution(
      'ambiguous',
      expectedKind,
      cleanName,
      candidates,
      'More than one canonical identity matches this value.',
    );
  }
  if (nameMatches.some(entity => entity.kind !== expectedKind)) {
    return resolution(
      'kind_conflict',
      expectedKind,
      cleanName,
      nameMatches,
      `${cleanName} is registered as ${nameMatches.map(entity => entity.kind).join(' or ')}, not ${expectedKind}.`,
    );
  }
  return resolution(
    'unresolved',
    expectedKind,
    cleanName,
    [],
    `No canonical ${expectedKind} matches this value.`,
  );
}

export function canonicalizeDAVEScheduleItems(
  items: readonly ScheduleItem[],
  input: Omit<BuildDAVEIdentityRegistryInput, 'scheduleItems'>,
): DAVEScheduleIdentityResult {
  const registry = buildDAVEIdentityRegistry({ ...input, scheduleItems: items });
  const issues: DAVEScheduleIdentityIssue[] = [];
  const canonicalItems = items.map(item => {
    const projectRaw = item.projectName.trim() || item.scheduleProjectName?.trim() || '';
    const projectResolution = resolveDAVEIdentity({
      rawName: projectRaw,
      expectedKind: 'project',
      registry,
    });
    const canonicalProjectName = projectResolution.entity?.canonicalName || projectRaw;
    const areaResolution = resolveDAVEIdentity({
      rawName: item.locationName,
      expectedKind: 'area',
      registry,
      parentProjectName: item.scheduleProjectName || canonicalProjectName,
    });
    const taskResolution = resolveDAVEIdentity({
      rawName: item.taskName,
      expectedKind: 'task',
      registry,
      parentProjectName: item.scheduleProjectName || canonicalProjectName,
    });

    if (projectResolution.status !== 'resolved') {
      issues.push(issue(item, 'project', projectResolution));
    }
    if (areaResolution.status !== 'resolved') {
      issues.push(issue(item, 'area', areaResolution));
    }
    if (taskResolution.status !== 'resolved') {
      issues.push(issue(item, 'task', taskResolution));
    }

    return {
      ...item,
      projectName: canonicalProjectName,
      locationName: areaResolution.status === 'resolved'
        ? areaResolution.entity?.canonicalName || item.locationName.trim()
        : '',
      taskName: taskResolution.entity?.canonicalName || item.taskName.trim(),
    };
  });

  return { items: canonicalItems, issues, registry };
}

export function scheduleTaskGroupName(item: ScheduleItem) {
  return safeScheduleAreaName(item) || 'Area Not Assigned';
}

function safeScheduleAreaName(item: ScheduleItem) {
  const areaName = item.locationName.trim();
  if (!areaName) return '';
  if (daveIdentityNamesMatch(areaName, item.projectName)) return '';
  if (daveIdentityNamesMatch(areaName, item.scheduleProjectName)) return '';
  return areaName;
}

function resolution(
  status: DAVEIdentityResolution['status'],
  expectedKind: DAVEEntityKind,
  rawName: string,
  candidates: DAVEIdentityEntity[],
  basis: string,
): DAVEIdentityResolution {
  return {
    status,
    expectedKind,
    rawName,
    entity: null,
    candidates,
    confidence: status === 'ambiguous' || status === 'kind_conflict' ? 'medium' : 'low',
    basis,
    needsVerification: true,
  };
}

function issue(
  item: ScheduleItem,
  field: DAVEScheduleIdentityIssue['field'],
  identity: DAVEIdentityResolution,
): DAVEScheduleIdentityIssue {
  return {
    itemId: item.id,
    field,
    status: identity.status,
    rawValue: identity.rawName,
    message: identity.basis,
  };
}
