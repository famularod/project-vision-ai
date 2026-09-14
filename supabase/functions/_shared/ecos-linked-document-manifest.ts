import {
  assertECOSLinkedProjectDocumentInventory,
  buildECOSLinkedProjectDocumentPlan,
  type ECOSLinkedProjectDocumentInventory,
} from './ecos-linked-project-document-inventory.ts';
import {
  assertECOSBoundTableSourceManifest,
  type ECOSBoundTableSourceManifest,
} from './ecos-table-source-manifest.ts';

export const ECOS_LINKED_DOCUMENT_MANIFEST_SCHEMA_VERSION =
  'ecos-linked-document-manifest/2.0' as const;

export interface ECOSLinkedDocumentManifest {
  schema_version: typeof ECOS_LINKED_DOCUMENT_MANIFEST_SCHEMA_VERSION;
  publication_mode: 'shadow';
  organization_id: string;
  owner_id: string;
  project_id: string;
  source_id: string;
  inventory_epoch_sha256: string;
  /** The original frozen inventory row retains association origins, source
   * metadata and any reviewed head/receipt pins without conflating hashes. */
  source: ECOSLinkedProjectDocumentInventory['rows'][number];
  /** Exact original manifest, including every pending or limited page. */
  manifest: Readonly<ECOSBoundTableSourceManifest>;
  currentness: 'supplied_inventory_snapshot_only';
  index_resolution: 'supplied_manifest_pairing_only';
  retrieval_authorized: false;
  answer_readiness: 'not_assessed';
  whole_project_completeness: 'not_assessed';
}

const origins = new WeakMap<object, ECOSLinkedProjectDocumentInventory>();

/**
 * Local composition of independently validated service readbacks. This does
 * not fetch a current head, resolve an indexing job, authenticate a caller, or
 * grant document retrieval. The caller still needs a fresh combined inventory
 * epoch and an independently resolved current extraction manifest at use time.
 *
 * In particular, an owner-reviewed association to a second project does not
 * permit relabeling a manifest indexed under the primary project. Actual source
 * bytes, manifest/page immutability, page coverage and semantic Assurance remain
 * separate requirements. Matching a supplied manifest is not factual approval.
 */
export function bindECOSLinkedDocumentManifest(
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
  sourceId: string,
  manifest: Readonly<ECOSBoundTableSourceManifest>,
): Readonly<ECOSLinkedDocumentManifest> {
  assertECOSLinkedProjectDocumentInventory(inventory);
  assertECOSBoundTableSourceManifest(manifest);
  // Do not normalize source identifiers or invoke user-defined conversion.
  // An exact match to the branded inventory also inherits its identity bounds.
  if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 300) {
    throw new Error('An exact inventoried source identity is required');
  }
  const item = buildECOSLinkedProjectDocumentPlan(inventory).items.find((
    item,
  ) => item.source.source_id === sourceId);
  if (!item || item.next_step !== 'needs_index_resolution') {
    throw new Error('Source is not an eligible supplied inventory candidate');
  }
  const source = item.source;
  const registry = source.registry_row;
  const evidence = manifest.accountability;
  if (
    registry === null ||
    evidence.organizationId !== inventory.organization_id ||
    evidence.projectId !== inventory.project_id ||
    evidence.sourceId !== source.source_id ||
    evidence.sourceSha256 !== registry.source_sha256 ||
    evidence.sourceRevision !== registry.source_revision ||
    evidence.expectedItemCount !== registry.source_page_count
  ) {
    throw new Error(
      'Manifest does not match the exact inventoried source scope and pins',
    );
  }
  const linked = Object.freeze({
    schema_version: ECOS_LINKED_DOCUMENT_MANIFEST_SCHEMA_VERSION,
    publication_mode: 'shadow' as const,
    organization_id: inventory.organization_id,
    owner_id: inventory.owner_id,
    project_id: inventory.project_id,
    source_id: source.source_id,
    inventory_epoch_sha256: inventory.epoch_sha256,
    source,
    manifest,
    currentness: 'supplied_inventory_snapshot_only' as const,
    index_resolution: 'supplied_manifest_pairing_only' as const,
    retrieval_authorized: false as const,
    answer_readiness: 'not_assessed' as const,
    whole_project_completeness: 'not_assessed' as const,
  });
  origins.set(linked, inventory);
  return linked;
}

/** Reject copied/forged pairs and substitution of another inventory snapshot,
 * even one with identical visible pins. This checks identity, not freshness. */
export function assertECOSLinkedDocumentManifest(
  value: unknown,
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
): asserts value is ECOSLinkedDocumentManifest {
  assertECOSLinkedProjectDocumentInventory(inventory);
  if (
    !value || typeof value !== 'object' || origins.get(value) !== inventory
  ) {
    throw new Error(
      'Linked manifest must originate from this exact inventory snapshot',
    );
  }
}
