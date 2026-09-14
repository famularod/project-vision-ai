import {
  buildECOSEvidenceGraph,
  type ECOSEvidenceGraph,
  type ECOSEvidenceNode,
} from './ecos-evidence-graph.ts';
import type { ECOSStoredTableRecords } from './ecos-stored-table-records.ts';
import {
  assertECOSBoundTableSourceManifest,
  assertECOSManifestTableRecords,
  type ECOSBoundTableSourceManifest,
} from './ecos-table-source-manifest.ts';

export const ECOS_TABLE_RETRIEVAL_BUNDLE_SCHEMA_VERSION =
  'ecos-table-retrieval-bundle/2.0' as const;
const MAX_SOURCES = 16;
const MAX_LOADED_PAGES = 32;
const MAX_RECORDS = 2_000;
const MAX_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

export interface ECOSTableRetrievalSource {
  manifest: ECOSBoundTableSourceManifest;
  pages: readonly Readonly<ECOSStoredTableRecords>[];
}
export interface ECOSTableRetrievalGap {
  code: string;
  sourceId: string | null;
  manifestId: string | null;
  pageNumber: number | null;
  tableId: string | null;
  rowNumber: number | null;
  columnNumber: number | null;
}
export interface ECOSUnloadedTablePage {
  sourceId: string;
  manifestId: string;
  pageNumber: number;
  itemKey: string;
  state: string;
  /** Native source records, NOT verified facts or guaranteed typed proposals. */
  hasUsableSourceRecords: boolean;
}
export interface ECOSTableRetrievalBundle {
  schemaVersion: typeof ECOS_TABLE_RETRIEVAL_BUNDLE_SCHEMA_VERSION;
  verificationStatus: 'structure_only_requires_assurance';
  organizationId: string;
  projectId: string;
  sources: readonly Readonly<ECOSTableRetrievalSource>[];
  coverage: Readonly<{
    scope: 'supplied_source_manifests_only';
    projectLibraryCompleteness: 'not_assessed';
    sourceCount: number;
    registeredPageCount: number;
    loadedPageCount: number;
    proposedRecordCount: number;
    fullyAccountedSuppliedInventory: boolean;
    allSuppliedPagesLoaded: boolean;
    allUsableSuppliedPagesLoaded: boolean;
    unloadedPages: readonly Readonly<ECOSUnloadedTablePage>[];
    unloadedUsablePageCount: number;
    extractionGapPageCount: number;
    typedProjectionGapCount: number;
  }>;
  gaps: readonly Readonly<ECOSTableRetrievalGap>[];
  limitations: readonly string[];
  graph: Readonly<ECOSEvidenceGraph> | null;
}

function exactScope(value: unknown, field: string): string {
  if (
    typeof value !== 'string' || !value || value !== value.trim() ||
    value.length > 500 || encoder.encode(value).length > 500 ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  ) {
    throw new Error(`${field} must be an exact bounded project identity`);
  }
  return value;
}
function dataObject(
  value: unknown,
  expectedKeys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) throw new Error(`${field} contains missing or unsupported fields`);
  const copy: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${field} must contain only data properties`);
    }
    copy[key] = descriptor.value;
  }
  return copy;
}
function dataArray(value: unknown, max: number, field: string): unknown[] {
  if (
    !Array.isArray(value) || value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new Error(`${field} exceeds its budget or is not a dense data array`);
  }
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${field} must contain only data properties`);
    }
    return descriptor.value;
  });
}
function uniqueIdentity(ids: Set<string>, value: string, field: string) {
  if (ids.has(value)) throw new Error(`${field} contains a duplicate identity`);
  ids.add(value);
}

/**
 * Internal composition of already manifest-bound shadow source proposals.
 * Private assertion brands prevent a caller-created lookalike from substituting
 * for the manifest/page binders. This function does not resolve a project library,
 * authenticate a customer, select current authority, rank conflicting rows,
 * perform natural-language retrieval, or create an answer. An empty claim list
 * and structurally valid graph are never evidence of semantic verification.
 *
 * Whole-input limits reject atomically. No truncated or successful prefix is
 * returned when the supplied scope exceeds its record, page, source or byte cap.
 */
export function buildECOSTableRetrievalBundle(input: {
  organizationId: string;
  projectId: string;
  sources: readonly ECOSTableRetrievalSource[];
}): Readonly<ECOSTableRetrievalBundle> {
  const request = dataObject(
    input,
    ['organizationId', 'projectId', 'sources'],
    'retrieval bundle',
  );
  const organizationId = exactScope(request.organizationId, 'organizationId');
  const projectId = exactScope(request.projectId, 'projectId');
  const sourceInputs = dataArray(
    request.sources,
    MAX_SOURCES,
    'retrieval source budget',
  );
  // Reserve framing/count fields and account for each bounded component before
  // retaining it. This avoids serializing all 32 maximum-size pages at once.
  let bytes = 4096;
  const accountBytes = (value: unknown) => {
    bytes += encoder.encode(JSON.stringify(value)).length + 1;
    if (bytes > MAX_BYTES) {
      throw new Error('retrieval bundle exceeds its serialized byte budget');
    }
  };
  const sources: Readonly<ECOSTableRetrievalSource>[] = [];
  const sourceIds = new Set<string>(),
    jobIds = new Set<string>(),
    manifestIds = new Set<string>();
  const projectionIds = new Set<string>(), recordIds = new Set<string>();
  const gaps: Readonly<ECOSTableRetrievalGap>[] = [];
  const unloadedPages: Readonly<ECOSUnloadedTablePage>[] = [];
  const nodes: ECOSEvidenceNode[] = [];
  let registeredPageCount = 0, loadedPageCount = 0, proposedRecordCount = 0;
  let unloadedUsablePageCount = 0,
    extractionGapPageCount = 0,
    typedProjectionGapCount = 0;
  let fullyAccountedSuppliedInventory = sourceInputs.length > 0;
  const addGap = (
    code: string,
    sourceId: string | null = null,
    manifestId: string | null = null,
    pageNumber: number | null = null,
    tableId: string | null = null,
    rowNumber: number | null = null,
    columnNumber: number | null = null,
  ) => {
    const gap = Object.freeze({
      code,
      sourceId,
      manifestId,
      pageNumber,
      tableId,
      rowNumber,
      columnNumber,
    });
    accountBytes(gap);
    gaps.push(gap);
  };
  if (sourceInputs.length === 0) addGap('no_sources_loaded');
  for (const sourceInput of sourceInputs) {
    const source = dataObject(
      sourceInput,
      ['manifest', 'pages'],
      'retrieval source',
    );
    assertECOSBoundTableSourceManifest(source.manifest);
    const manifest = source.manifest;
    const scope = manifest.accountability;
    if (
      scope.organizationId !== organizationId || scope.projectId !== projectId
    ) throw new Error('retrieval manifest crosses the project scope');
    uniqueIdentity(sourceIds, scope.sourceId, 'retrieval sources');
    uniqueIdentity(jobIds, manifest.jobId, 'retrieval jobs');
    uniqueIdentity(manifestIds, manifest.manifestId, 'retrieval manifests');
    accountBytes(manifest);
    registeredPageCount += scope.expectedItemCount;
    if (!scope.fullyAccounted) {
      fullyAccountedSuppliedInventory = false;
      addGap(
        'source_inventory_incomplete',
        scope.sourceId,
        manifest.manifestId,
      );
    }
    const pageInputs = dataArray(
      source.pages,
      MAX_LOADED_PAGES - loadedPageCount,
      'retrieval loaded page budget',
    );
    const pages: Readonly<ECOSStoredTableRecords>[] = [];
    const pageNumbers = new Set<number>();
    for (const candidate of pageInputs) {
      assertECOSManifestTableRecords(candidate, manifest);
      const page = candidate;
      const pageScope = page.projection.source;
      const number = pageScope.pageNumber;
      if (pageNumbers.has(number)) {
        throw new Error('retrieval source contains a duplicate page');
      }
      pageNumbers.add(number);
      const item = manifest.items[number - 1];
      if (
        !item || item.pageNumber !== number ||
        pageScope.organizationId !== organizationId ||
        pageScope.projectId !== projectId ||
        pageScope.sourceId !== scope.sourceId ||
        pageScope.sourceSha256 !== scope.sourceSha256 ||
        pageScope.sourceRevision !== scope.sourceRevision ||
        pageScope.jobId !== manifest.jobId ||
        pageScope.manifestId !== manifest.manifestId ||
        pageScope.snapshotId !== scope.snapshotId ||
        pageScope.extractionVersion !== scope.extractionVersion ||
        pageScope.sourcePageCount !== scope.expectedItemCount ||
        page.storage.projectionId !== item.projectionId ||
        page.storage.projectionSha256 !== item.projectionSha256
      ) {
        throw new Error(
          'retrieval page does not match its exact manifest item',
        );
      }
      uniqueIdentity(
        projectionIds,
        page.storage.projectionId,
        'retrieval projections',
      );
      loadedPageCount++;
      proposedRecordCount += page.projection.records.length;
      if (proposedRecordCount > MAX_RECORDS) {
        throw new Error('retrieval bundle exceeds proposed record budget');
      }
      accountBytes(page);
      pages.push(page);
      for (const gap of page.projection.gaps) {
        typedProjectionGapCount++;
        addGap(
          gap.code,
          scope.sourceId,
          manifest.manifestId,
          number,
          gap.tableId,
          gap.rowNumber,
          gap.columnNumber,
        );
      }
      for (const wrapper of page.projection.records) {
        const record = wrapper.record;
        uniqueIdentity(recordIds, record.id, 'retrieval records');
        const locator = record.locator;
        if (
          record.organizationId !== organizationId ||
          record.projectId !== projectId ||
          record.assertionKind !== 'proposed_fact' ||
          record.verificationStatus !== 'structure_only_requires_assurance' ||
          locator.manifestId !== manifest.manifestId ||
          locator.snapshotId !== scope.snapshotId ||
          locator.sourceId !== scope.sourceId ||
          locator.sourceSha256 !== scope.sourceSha256 ||
          locator.extractionVersion !== scope.extractionVersion ||
          locator.pageNumber !== number || locator.itemKey !== item.itemKey
        ) {
          throw new Error(
            'retrieval proposed record does not match its exact manifest item',
          );
        }
        nodes.push({
          id: record.id,
          organizationId,
          projectId,
          kind: 'observation',
          label: record.subject,
          provenance: {
            manifestId: locator.manifestId,
            sourceId: locator.sourceId,
            sourceSha256: locator.sourceSha256,
            snapshotId: locator.snapshotId,
            extractionVersion: locator.extractionVersion,
            itemKey: locator.itemKey,
            pageNumber: locator.pageNumber,
            sheetNumber: locator.sheetNumber,
            regionId: locator.regionId,
          },
          attributes: {
            recordId: record.id,
            factKind: record.factKind,
            assertionKind: 'proposed_fact',
            verificationStatus: 'structure_only_requires_assurance',
          },
        });
      }
    }
    sources.push(Object.freeze({ manifest, pages: Object.freeze(pages) }));
    for (const item of manifest.items) {
      if (item.gapCode !== null) {
        extractionGapPageCount++;
        addGap(
          item.gapCode,
          scope.sourceId,
          manifest.manifestId,
          item.pageNumber,
        );
      }
      if (pageNumbers.has(item.pageNumber)) continue;
      const hasUsableSourceRecords = item.state === 'partial' &&
        item.evidenceRecordCount > 0;
      const unloaded = Object.freeze({
        sourceId: scope.sourceId,
        manifestId: manifest.manifestId,
        pageNumber: item.pageNumber,
        itemKey: item.itemKey,
        state: item.state,
        hasUsableSourceRecords,
      });
      accountBytes(unloaded);
      unloadedPages.push(unloaded);
      if (hasUsableSourceRecords) unloadedUsablePageCount++;
      addGap(
        hasUsableSourceRecords
          ? 'usable_source_page_not_loaded'
          : 'source_page_not_loaded',
        scope.sourceId,
        manifest.manifestId,
        item.pageNumber,
      );
    }
  }
  const graph = fullyAccountedSuppliedInventory
    ? buildECOSEvidenceGraph({
      organizationId,
      projectId,
      sourceManifests: sources.map(({ manifest }) => ({
        id: manifest.manifestId,
        accountability: manifest.accountability,
      })),
      nodes,
      relations: [],
      claims: [],
    })
    : null;
  if (graph) accountBytes(graph);
  const result = Object.freeze({
    schemaVersion: ECOS_TABLE_RETRIEVAL_BUNDLE_SCHEMA_VERSION,
    verificationStatus: 'structure_only_requires_assurance' as const,
    organizationId,
    projectId,
    sources: Object.freeze(sources),
    coverage: Object.freeze({
      scope: 'supplied_source_manifests_only' as const,
      projectLibraryCompleteness: 'not_assessed' as const,
      sourceCount: sources.length,
      registeredPageCount,
      loadedPageCount,
      proposedRecordCount,
      fullyAccountedSuppliedInventory,
      allSuppliedPagesLoaded: sources.length > 0 && unloadedPages.length === 0,
      allUsableSuppliedPagesLoaded: sources.length > 0 &&
        unloadedUsablePageCount === 0,
      unloadedPages: Object.freeze(unloadedPages),
      unloadedUsablePageCount,
      extractionGapPageCount,
      typedProjectionGapCount,
    }),
    gaps: Object.freeze(gaps),
    limitations: Object.freeze([
      'project_library_completeness_not_assessed',
      'current_source_authority_unresolved',
      'conflicting_occurrences_not_ranked_or_resolved',
      'natural_language_retrieval_not_implemented',
    ]),
    graph,
  });
  if (encoder.encode(JSON.stringify(result)).length > MAX_BYTES) {
    throw new Error('retrieval bundle exceeds its serialized byte budget');
  }
  return result;
}
