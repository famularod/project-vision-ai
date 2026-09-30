import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import type { ScheduleItem } from '../types';

export type ScheduleImportScopeProject = Readonly<{
  id?: string | null;
  /**
   * Stable bridge identity retained while a legacy name-only project is
   * reconciled to its immutable cloud UUID.
   */
  importIdentity?: string | null;
  name: string;
}>;

export type ScheduleImportSourceIdentity = Readonly<{
  contentSha256: string;
  scopeKey: string;
  idempotencyKey: string;
  batchId: string;
  documentId: string;
}>;

/**
 * Gives the same schedule bytes and explicitly selected project scope one
 * stable identity on every client. File names, picker paths, device IDs, and
 * upload timestamps are deliberately excluded.
 */
export function buildScheduleImportSourceIdentity({
  bytes,
  projects,
  generation = 0,
}: Readonly<{
  bytes: ArrayBuffer | Uint8Array;
  projects: readonly ScheduleImportScopeProject[];
  /** 0 for a first import; see resolveScheduleImportSourceIdentity. */
  generation?: number;
}>): ScheduleImportSourceIdentity {
  const sourceBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const contentSha256 = hex(sha256(sourceBytes));
  const scopeKey = canonicalScheduleImportScope(projects).join('|') || 'no-project-scope';
  const idempotencyKey = hex(sha256(utf8ToBytes(
    `vitruvius-schedule-import-v1|${contentSha256}|${scopeKey}${generation > 0 ? `|reimport:${generation}` : ''}`,
  )));

  return Object.freeze({
    contentSha256,
    scopeKey,
    idempotencyKey,
    batchId: `schedule-import-${idempotencyKey}`,
    documentId: `schedule-document-${idempotencyKey}`,
  });
}

/**
 * The identity for importing these bytes into this scope now (whole-app audit
 * A5, 30 Sep 2026). Deleting an imported schedule leaves a deletion record
 * for its document id, and deletion records always win, so importing the same
 * file again produced the same ids and every reviewed row was dropped at
 * approval. Each deleted generation moves the identity to the next one; the
 * walk depends only on the synced deletion records, so every device that has
 * them derives the same ids and a retry stays idempotent.
 */
export function resolveScheduleImportSourceIdentity({
  bytes,
  projects,
  documentIdIsDeleted,
}: Readonly<{
  bytes: ArrayBuffer | Uint8Array;
  projects: readonly ScheduleImportScopeProject[];
  documentIdIsDeleted: (documentId: string) => boolean;
}>): ScheduleImportSourceIdentity {
  let identity = buildScheduleImportSourceIdentity({ bytes, projects });
  for (let generation = 1; generation <= 100 && documentIdIsDeleted(identity.documentId); generation += 1) {
    identity = buildScheduleImportSourceIdentity({ bytes, projects, generation });
  }
  return identity;
}

export function canonicalScheduleImportScope(
  projects: readonly ScheduleImportScopeProject[],
): string[] {
  return [...new Set(projects.map(project => {
    const importIdentity = normalize(project.importIdentity);
    if (importIdentity) return `id:${importIdentity}`;
    const id = normalize(project.id);
    if (id) return `id:${id}`;
    const name = normalize(project.name);
    return name ? `name:${name}` : '';
  }).filter(Boolean))].sort();
}

/**
 * Task rows also receive stable IDs so a retry or another device cannot create
 * a second cloud task merely because the extractor generated a new UUID.
 */
export function bindStableScheduleImportItemIds(
  items: readonly ScheduleItem[],
  source: ScheduleImportSourceIdentity,
): ScheduleItem[] {
  return items.map(item => ({
    ...item,
    id: stableScheduleImportItemId(item, source),
    importBatchId: source.batchId,
    sourceDocumentId: source.documentId,
  }));
}

export function stableScheduleImportItemId(
  item: ScheduleItem,
  source: Pick<ScheduleImportSourceIdentity, 'idempotencyKey'>,
): string {
  const canonicalItem = [
    item.scheduleProjectName,
    item.projectName,
    item.locationName,
    item.taskName,
    item.startDate,
    item.finishDate,
    item.milestone,
    item.sourceActivityId,
    item.sourceWbsCode || item.wbsCode,
    item.sourceRowNumber,
  ].map(normalize).join('|');
  const digest = hex(sha256(utf8ToBytes(
    `vitruvius-schedule-item-v1|${source.idempotencyKey}|${canonicalItem}`,
  )));
  return `schedule-item-${digest}`;
}

function normalize(value: string | number | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.trunc(value)) : '';
  }
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}

function hex(bytes: Uint8Array) {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}
