import {
  type ECOSSourceAccountabilityManifest,
  validateECOSSourceAccountabilityManifest,
} from './ecos-source-accountability.ts';

export const ECOS_EVIDENCE_GRAPH_SCHEMA_VERSION =
  'ecos-evidence-graph/2.0' as const;

export type ECOSEvidenceNodeKind =
  | 'project'
  | 'document'
  | 'page'
  | 'sheet'
  | 'area'
  | 'task'
  | 'schedule_activity'
  | 'rfi'
  | 'submittal'
  | 'field_note'
  | 'photo'
  | 'requirement'
  | 'measurement'
  | 'observation';

export type ECOSEvidenceRelationKind =
  | 'contains'
  | 'located_at'
  | 'references'
  | 'supersedes'
  | 'affects'
  | 'supports'
  | 'contradicts'
  | 'scheduled_by'
  | 'evidenced_by';

export type ECOSClaimKind = 'fact' | 'inference' | 'recommendation';

export interface ECOSEvidenceProvenance {
  manifestId: string;
  sourceId: string;
  sourceSha256: string;
  snapshotId: string;
  extractionVersion: string;
  itemKey: string;
  pageNumber?: number | null;
  sheetNumber?: string | null;
  regionId?: string | null;
}

export interface ECOSEvidenceNode {
  id: string;
  organizationId: string;
  projectId: string;
  kind: ECOSEvidenceNodeKind;
  label: string;
  provenance?: ECOSEvidenceProvenance | null;
  attributes?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ECOSEvidenceRelation {
  id: string;
  kind: ECOSEvidenceRelationKind;
  fromNodeId: string;
  toNodeId: string;
}

export interface ECOSEvidenceCitation extends ECOSEvidenceProvenance {
  nodeId: string;
}

export interface ECOSEvidenceClaim {
  id: string;
  kind: ECOSClaimKind;
  statement: string;
  supportingNodeIds: readonly string[];
  dependsOnClaimIds: readonly string[];
  citations: readonly ECOSEvidenceCitation[];
  confidence: number;
  limitations: readonly string[];
  requiresHumanReview: boolean;
  rationale?: string | null;
}

export interface ECOSEvidenceGraphSourceManifest {
  id: string;
  accountability: ECOSSourceAccountabilityManifest;
}

export interface ECOSEvidenceGraphInput {
  organizationId: string;
  projectId: string;
  sourceManifests: readonly ECOSEvidenceGraphSourceManifest[];
  nodes: readonly ECOSEvidenceNode[];
  relations: readonly ECOSEvidenceRelation[];
  claims: readonly ECOSEvidenceClaim[];
}

export interface ECOSEvidenceGraph extends ECOSEvidenceGraphInput {
  schemaVersion: typeof ECOS_EVIDENCE_GRAPH_SCHEMA_VERSION;
  verificationStatus: 'structure_only_requires_assurance';
}

const NODE_KINDS = new Set<ECOSEvidenceNodeKind>([
  'project',
  'document',
  'page',
  'sheet',
  'area',
  'task',
  'schedule_activity',
  'rfi',
  'submittal',
  'field_note',
  'photo',
  'requirement',
  'measurement',
  'observation',
]);

const RELATION_KINDS = new Set<ECOSEvidenceRelationKind>([
  'contains',
  'located_at',
  'references',
  'supersedes',
  'affects',
  'supports',
  'contradicts',
  'scheduled_by',
  'evidenced_by',
]);

const CLAIM_KINDS = new Set<ECOSClaimKind>([
  'fact',
  'inference',
  'recommendation',
]);

const SOURCE_DERIVED_NODE_KINDS = new Set<ECOSEvidenceNodeKind>([
  'document',
  'page',
  'sheet',
  'task',
  'schedule_activity',
  'rfi',
  'submittal',
  'field_note',
  'photo',
  'requirement',
  'measurement',
  'observation',
]);

function exactText(value: unknown, field: string, maximumBytes: number) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (
    !trimmed || new TextEncoder().encode(trimmed).length > maximumBytes ||
    [...trimmed].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) throw new Error(`${field} is not valid bounded text`);
  return trimmed;
}

function exactSha256(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be one lowercase SHA-256 value`);
  }
  return value;
}

function exactIdentity(value: unknown, field: string, maximumBytes = 300) {
  const normalized = exactText(value, field, maximumBytes);
  if (normalized !== value) {
    throw new Error(`${field} must not change its exact identity`);
  }
  return normalized;
}

function boundedConfidence(value: unknown, field: string) {
  if (
    typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
    value > 1
  ) {
    throw new Error(`${field} must be a number from zero through one`);
  }
  return value;
}

function uniqueBoundedStrings(
  values: readonly string[],
  field: string,
  maximumValues: number,
  maximumBytes = 300,
) {
  if (!Array.isArray(values) || values.length > maximumValues) {
    throw new Error(`${field} exceeds its bounded list`);
  }
  const result = values.map((value, index) =>
    exactText(value, `${field}[${index}]`, maximumBytes)
  );
  if (new Set(result).size !== result.length) {
    throw new Error(`${field} contains duplicates`);
  }
  return Object.freeze(result);
}

function optionalExactText(
  value: unknown,
  field: string,
  maximumBytes: number,
) {
  return value == null ? null : exactText(value, field, maximumBytes);
}

function uniqueBoundedIdentities(values: readonly string[], field: string) {
  const normalized = uniqueBoundedStrings(values, field, 100);
  if (normalized.some((value, index) => value !== values[index])) {
    throw new Error(`${field} must not change its exact identities`);
  }
  return normalized;
}

function normalizedProvenance(
  value: ECOSEvidenceProvenance,
  field: string,
): ECOSEvidenceProvenance {
  if (!value || typeof value !== 'object') {
    throw new Error(`${field} is required`);
  }
  const pageNumber = value.pageNumber == null ? null : value.pageNumber;
  if (
    pageNumber != null &&
    (typeof pageNumber !== 'number' || !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 || pageNumber > 10_000)
  ) throw new Error(`${field}.pageNumber is outside its supported range`);
  return Object.freeze({
    manifestId: exactIdentity(value.manifestId, `${field}.manifestId`),
    sourceId: exactIdentity(value.sourceId, `${field}.sourceId`),
    sourceSha256: exactSha256(value.sourceSha256, `${field}.sourceSha256`),
    snapshotId: exactIdentity(value.snapshotId, `${field}.snapshotId`),
    extractionVersion: exactIdentity(
      value.extractionVersion,
      `${field}.extractionVersion`,
    ),
    itemKey: exactIdentity(value.itemKey, `${field}.itemKey`),
    pageNumber,
    sheetNumber: value.sheetNumber == null
      ? null
      : exactIdentity(value.sheetNumber, `${field}.sheetNumber`, 100),
    regionId: value.regionId == null
      ? null
      : exactIdentity(value.regionId, `${field}.regionId`),
  });
}

function sameProvenance(
  left: ECOSEvidenceProvenance,
  right: ECOSEvidenceProvenance,
) {
  return left.manifestId === right.manifestId &&
    left.sourceId === right.sourceId &&
    left.sourceSha256 === right.sourceSha256 &&
    left.snapshotId === right.snapshotId &&
    left.extractionVersion === right.extractionVersion &&
    left.itemKey === right.itemKey &&
    (left.pageNumber ?? null) === (right.pageNumber ?? null) &&
    (left.sheetNumber ?? null) === (right.sheetNumber ?? null) &&
    (left.regionId ?? null) === (right.regionId ?? null);
}

function assertClaimDependenciesReachFacts(
  claimsById: ReadonlyMap<string, ECOSEvidenceClaim>,
) {
  // Topological traversal is linear in nodes + dependencies and does not use
  // the JS call stack for long (but bounded) reasoning chains.
  const remainingDependencies = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const reachesFact = new Set<string>();
  const ready: string[] = [];
  let dependencyCount = 0;
  for (const claim of claimsById.values()) {
    dependencyCount += claim.dependsOnClaimIds.length;
    if (dependencyCount > 100_000) {
      throw new Error('claims exceed the total dependency budget');
    }
    remainingDependencies.set(claim.id, claim.dependsOnClaimIds.length);
    if (claim.dependsOnClaimIds.length === 0) ready.push(claim.id);
    for (const dependencyId of claim.dependsOnClaimIds) {
      const next = dependents.get(dependencyId) ?? [];
      next.push(claim.id);
      dependents.set(dependencyId, next);
    }
  }
  for (let index = 0; index < ready.length; index++) {
    const claim = claimsById.get(ready[index])!;
    if (
      claim.kind === 'fact' ||
      claim.dependsOnClaimIds.some((id) => reachesFact.has(id))
    ) {
      reachesFact.add(claim.id);
    }
    for (const dependentId of dependents.get(claim.id) ?? []) {
      const remaining = remainingDependencies.get(dependentId)! - 1;
      remainingDependencies.set(dependentId, remaining);
      if (remaining === 0) ready.push(dependentId);
    }
  }
  if (ready.length !== claimsById.size) {
    throw new Error('claims contain a dependency cycle');
  }
  if (reachesFact.size !== claimsById.size) {
    throw new Error('claims do not trace to a source-grounded fact');
  }
}

/**
 * Validates the structure of one project-isolated graph against its complete
 * source-item receipts. Claim kinds describe proposed content, NOT verified
 * truth: this does not verify a statement's meaning, region or sheet content.
 * All claims still require exact-content Assurance before customer display.
 * Recommendations are reviewable guidance, never autonomous project mutations.
 */
export function buildECOSEvidenceGraph(
  input: ECOSEvidenceGraphInput,
): ECOSEvidenceGraph {
  if (!input || typeof input !== 'object') {
    throw new Error('evidence graph input is required');
  }
  if (!Array.isArray(input.nodes) || input.nodes.length > 10_000) {
    throw new Error('nodes exceeds its bounded list');
  }
  if (!Array.isArray(input.relations) || input.relations.length > 25_000) {
    throw new Error('relations exceeds its bounded list');
  }
  if (!Array.isArray(input.claims) || input.claims.length > 10_000) {
    throw new Error('claims exceeds its bounded list');
  }
  const organizationId = exactIdentity(
    input.organizationId,
    'organizationId',
    500,
  );
  const projectId = exactIdentity(input.projectId, 'projectId', 500);

  if (
    !Array.isArray(input.sourceManifests) ||
    input.sourceManifests.length > 1_000
  ) {
    throw new Error('sourceManifests exceeds its bounded list');
  }
  const manifestsById = new Map<string, ECOSEvidenceGraphSourceManifest>();
  const manifestItemsById = new Map<
    string,
    ReadonlyMap<string, ECOSSourceAccountabilityManifest['items'][number]>
  >();
  let sourceItemCount = 0;
  const sourceManifests = input.sourceManifests.map((manifest, index) => {
    if (!manifest || typeof manifest !== 'object') {
      throw new Error(`sourceManifests[${index}] must be an object`);
    }
    const id = exactIdentity(manifest.id, `sourceManifests[${index}].id`);
    if (manifestsById.has(id)) {
      throw new Error('sourceManifests contains a duplicate id');
    }
    const accountability = validateECOSSourceAccountabilityManifest(
      manifest.accountability,
    );
    if (
      accountability.organizationId !== organizationId ||
      accountability.projectId !== projectId
    ) {
      throw new Error(
        `sourceManifests[${index}] crosses the graph project boundary`,
      );
    }
    if (!accountability.fullyAccounted) {
      throw new Error(`sourceManifests[${index}] is not fully accounted`);
    }
    sourceItemCount += accountability.items.length;
    if (sourceItemCount > 100_000) {
      throw new Error('sourceManifests exceeds the total item budget');
    }
    const normalized = Object.freeze({ id, accountability });
    manifestsById.set(id, normalized);
    manifestItemsById.set(
      id,
      new Map(accountability.items.map((item) => [item.itemKey, item])),
    );
    return normalized;
  });

  const nodesById = new Map<string, ECOSEvidenceNode>();
  const nodes = input.nodes.map((node, index) => {
    if (!node || typeof node !== 'object') {
      throw new Error(`nodes[${index}] must be an object`);
    }
    if (!NODE_KINDS.has(node.kind)) {
      throw new Error(`nodes[${index}].kind is unsupported`);
    }
    const id = exactIdentity(node.id, `nodes[${index}].id`);
    if (nodesById.has(id)) throw new Error('nodes contains a duplicate id');
    if (
      node.organizationId !== organizationId || node.projectId !== projectId
    ) {
      throw new Error(`nodes[${index}] crosses the graph project boundary`);
    }
    if (node.attributes != null) {
      if (
        typeof node.attributes !== 'object' || Array.isArray(node.attributes) ||
        Object.keys(node.attributes).length > 100
      ) throw new Error(`nodes[${index}].attributes is not a bounded object`);
      for (
        const [attributeKey, attributeValue] of Object.entries(node.attributes)
      ) {
        exactText(attributeKey, `nodes[${index}].attributes key`, 100);
        if (
          attributeValue !== null && typeof attributeValue !== 'string' &&
          typeof attributeValue !== 'number' &&
          typeof attributeValue !== 'boolean'
        ) {
          throw new Error(
            `nodes[${index}].attributes contains an unsupported value`,
          );
        }
        if (typeof attributeValue === 'string') {
          exactText(
            attributeValue,
            `nodes[${index}].attributes.${attributeKey}`,
            2_000,
          );
        }
        if (
          typeof attributeValue === 'number' && !Number.isFinite(attributeValue)
        ) {
          throw new Error(
            `nodes[${index}].attributes contains a non-finite number`,
          );
        }
      }
    }
    const provenance = node.provenance == null
      ? null
      : normalizedProvenance(node.provenance, `nodes[${index}].provenance`);
    if (SOURCE_DERIVED_NODE_KINDS.has(node.kind) && provenance == null) {
      throw new Error(`nodes[${index}] requires exact source provenance`);
    }
    if (provenance) {
      const manifest = manifestsById.get(provenance.manifestId);
      if (!manifest) {
        throw new Error(
          `nodes[${index}] references an unknown source manifest`,
        );
      }
      if (
        manifest.accountability.sourceId !== provenance.sourceId ||
        manifest.accountability.sourceSha256 !== provenance.sourceSha256 ||
        manifest.accountability.snapshotId !== provenance.snapshotId ||
        manifest.accountability.extractionVersion !==
          provenance.extractionVersion
      ) throw new Error(`nodes[${index}] does not match its source manifest`);
      const item = manifestItemsById.get(provenance.manifestId)!.get(
        provenance.itemKey,
      );
      if (!item) {
        throw new Error(`nodes[${index}] references an unknown source item`);
      }
      if (
        (item.state !== 'complete' && item.state !== 'partial') ||
        item.evidenceRecordCount < 1
      ) {
        throw new Error(
          `nodes[${index}] references a source item without usable evidence`,
        );
      }
      if (
        (item.itemKind === 'page' && provenance.pageNumber !== item.ordinal) ||
        (item.itemKind !== 'page' && provenance.pageNumber != null)
      ) {
        throw new Error(
          `nodes[${index}] page locator does not match its source item`,
        );
      }
    }
    const normalized = Object.freeze({
      id,
      organizationId,
      projectId,
      kind: node.kind,
      label: exactText(node.label, `nodes[${index}].label`, 1_000),
      provenance,
      attributes: node.attributes == null
        ? undefined
        : Object.freeze({ ...node.attributes }),
    });
    nodesById.set(id, normalized);
    return normalized;
  });

  const relationIds = new Set<string>();
  const relations = input.relations.map((relation, index) => {
    if (!relation || typeof relation !== 'object') {
      throw new Error(`relations[${index}] must be an object`);
    }
    if (!RELATION_KINDS.has(relation.kind)) {
      throw new Error(`relations[${index}].kind is unsupported`);
    }
    const id = exactIdentity(relation.id, `relations[${index}].id`);
    if (relationIds.has(id)) {
      throw new Error('relations contains a duplicate id');
    }
    relationIds.add(id);
    const fromNodeId = exactIdentity(
      relation.fromNodeId,
      `relations[${index}].fromNodeId`,
    );
    const toNodeId = exactIdentity(
      relation.toNodeId,
      `relations[${index}].toNodeId`,
    );
    if (!nodesById.has(fromNodeId) || !nodesById.has(toNodeId)) {
      throw new Error(`relations[${index}] references an unknown node`);
    }
    if (fromNodeId === toNodeId) {
      throw new Error(`relations[${index}] is self-referential`);
    }
    return Object.freeze({ id, kind: relation.kind, fromNodeId, toNodeId });
  });

  const claimsById = new Map<string, ECOSEvidenceClaim>();
  let totalCitationCount = 0;
  const claims = input.claims.map((claim, index) => {
    if (!claim || typeof claim !== 'object') {
      throw new Error(`claims[${index}] must be an object`);
    }
    if (!CLAIM_KINDS.has(claim.kind)) {
      throw new Error(`claims[${index}].kind is unsupported`);
    }
    const id = exactIdentity(claim.id, `claims[${index}].id`);
    if (claimsById.has(id)) throw new Error('claims contains a duplicate id');
    const supportingNodeIds = uniqueBoundedIdentities(
      claim.supportingNodeIds,
      `claims[${index}].supportingNodeIds`,
    );
    const dependsOnClaimIds = uniqueBoundedIdentities(
      claim.dependsOnClaimIds,
      `claims[${index}].dependsOnClaimIds`,
    );
    if (claim.kind === 'fact' && dependsOnClaimIds.length > 0) {
      throw new Error(`claims[${index}] fact cannot depend on another claim`);
    }
    if (claim.kind !== 'fact' && dependsOnClaimIds.length === 0) {
      throw new Error(
        `claims[${index}] ${claim.kind} requires a claim dependency`,
      );
    }
    if (supportingNodeIds.length === 0) {
      throw new Error(`claims[${index}] requires a supporting evidence node`);
    }
    for (const nodeId of supportingNodeIds) {
      if (!nodesById.has(nodeId)) {
        throw new Error(`claims[${index}] references an unknown node`);
      }
    }
    if (
      !Array.isArray(claim.citations) || claim.citations.length < 1 ||
      claim.citations.length > 100
    ) {
      throw new Error(`claims[${index}] requires a bounded citation list`);
    }
    totalCitationCount += claim.citations.length;
    if (totalCitationCount > 100_000) {
      throw new Error('claims exceed the total citation budget');
    }
    const citationKeys = new Set<string>();
    const citedNodeIds = new Set<string>();
    const citations = claim.citations.map((
      citation: ECOSEvidenceCitation,
      citationIndex: number,
    ) => {
      const nodeId = exactIdentity(
        citation?.nodeId,
        `claims[${index}].citations[${citationIndex}].nodeId`,
        300,
      );
      if (!supportingNodeIds.includes(nodeId)) {
        throw new Error(`claims[${index}] citation is not a supporting node`);
      }
      const node = nodesById.get(nodeId)!;
      if (!node.provenance) {
        throw new Error(`claims[${index}] citation node lacks provenance`);
      }
      const provenance = normalizedProvenance(
        citation,
        `claims[${index}].citations[${citationIndex}]`,
      );
      if (!sameProvenance(node.provenance, provenance)) {
        throw new Error(
          `claims[${index}] citation does not match its evidence node`,
        );
      }
      const key =
        `${nodeId}\u0000${provenance.manifestId}\u0000${provenance.itemKey}\u0000${
          provenance.regionId ?? ''
        }`;
      if (citationKeys.has(key)) {
        throw new Error(`claims[${index}] contains a duplicate citation`);
      }
      citationKeys.add(key);
      citedNodeIds.add(nodeId);
      return Object.freeze({ nodeId, ...provenance });
    });
    if (supportingNodeIds.some((nodeId) => !citedNodeIds.has(nodeId))) {
      throw new Error(`claims[${index}] has an uncited supporting node`);
    }
    if (typeof claim.requiresHumanReview !== 'boolean') {
      throw new Error(`claims[${index}].requiresHumanReview must be boolean`);
    }
    if (claim.kind === 'recommendation' && claim.requiresHumanReview !== true) {
      throw new Error(
        `claims[${index}] recommendation must require human review`,
      );
    }
    const rationale = optionalExactText(
      claim.rationale,
      `claims[${index}].rationale`,
      2_000,
    );
    if (claim.kind === 'recommendation' && rationale == null) {
      throw new Error(`claims[${index}] recommendation requires a rationale`);
    }
    const normalized = Object.freeze({
      id,
      kind: claim.kind,
      statement: exactText(
        claim.statement,
        `claims[${index}].statement`,
        4_000,
      ),
      supportingNodeIds,
      dependsOnClaimIds,
      citations: Object.freeze(citations),
      confidence: boundedConfidence(
        claim.confidence,
        `claims[${index}].confidence`,
      ),
      limitations: uniqueBoundedStrings(
        claim.limitations,
        `claims[${index}].limitations`,
        100,
        500,
      ),
      requiresHumanReview: claim.requiresHumanReview === true,
      rationale,
    });
    claimsById.set(id, normalized);
    return normalized;
  });

  for (const [index, claim] of claims.entries()) {
    for (const dependencyId of claim.dependsOnClaimIds) {
      if (!claimsById.has(dependencyId)) {
        throw new Error(
          `claims[${index}] references an unknown claim dependency`,
        );
      }
      if (dependencyId === claim.id) {
        throw new Error(`claims[${index}] is self-dependent`);
      }
    }
  }
  assertClaimDependenciesReachFacts(claimsById);

  return Object.freeze({
    schemaVersion: ECOS_EVIDENCE_GRAPH_SCHEMA_VERSION,
    verificationStatus: 'structure_only_requires_assurance',
    organizationId,
    projectId,
    sourceManifests: Object.freeze(sourceManifests),
    nodes: Object.freeze(nodes),
    relations: Object.freeze(relations),
    claims: Object.freeze(claims),
  });
}
