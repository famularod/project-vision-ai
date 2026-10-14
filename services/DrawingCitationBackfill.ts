import type { ReferenceDocument } from '../types';
import { canonicalReferenceCategory } from './AuthoritativeDocumentSystem';
import {
  CITATION_PAGE_INDEX_KEY,
  citationPageIndexOfTheRowsOwnIndex,
} from './ECOSDocumentIndexPersistence';

/**
 * HIGH ITEM 3, option (b2) (the coordinator's decision on Q52 B, 13 Oct 2026): the backfill.
 *
 * A drawing sent before this build has no citation slice in its row (document_data.citationPageIndex), so the
 * document list carries none and no device shows its piece. Where its row still holds the drawing's own whole index
 * (document_data.extractedPages, which the live list leaves out: a drawing a phone or iPad read and sent, and that no
 * device has edited since), the desktop writes the slice once:
 *  - WHO AND WHEN: the desktop only (phones and iPads never backfill), after it has read the document list (each page
 *    load and each 30-minute refresh), in the background; each drawing at most once per page session.
 *  - WHICH: drawings whose listed row has no slice key; Google Drive ones are left (their rows hold no index).
 *  - HOW: one narrow read of the candidates' own index (document_data->extractedPages, nothing else), then, for each,
 *    an update of that row ONLY IF it is still the row the list gave (updated_at unchanged): document_data exactly as
 *    the list gave it, its index put back as read, and the slice added. Nothing else moves, not document_data's own
 *    updatedAt (no device takes it for an edit). Two desktops at once, or any write in between: the second write
 *    matches no row and is dropped; the next list shows the key.
 *  - A drawing whose row no longer holds an index (emptied by an edit, prepared elsewhere): nothing is sent.
 *  - A drawing whose index names no work area: the slice is written with no pages ("nothing to cite"), so it is not
 *    read again.
 * No database change: the table's own owner rules; the same reads and conditional updates the desktop already makes.
 */
type BackfillQuery = {
  from(table: 'reference_documents'): {
    select(columns: string): { eq(column: string, value: string): { in(column: string, values: string[]): PromiseLike<{ data: unknown; error: unknown }> } };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): any;
    };
  };
};

export async function backfillDrawingCitationPageIndexes({
  client,
  ownerId,
  listedRows,
  seen = new Set<string>(),
  now = () => new Date().toISOString(),
}: {
  client: BackfillQuery | unknown;
  ownerId: string;
  /** The rows of the document list just read: document_data without extractedPages. */
  listedRows: readonly unknown[];
  /** Rows already tried in this page session (id and the updated_at the list gave). */
  seen?: Set<string>;
  now?: () => string;
}): Promise<{ written: string[] }> {
  const written: string[] = [];
  const candidates = new Map<string, { updatedAt: string; data: Record<string, unknown> }>();
  listedRows.forEach(value => {
    const row = record(value);
    const data = record(row.document_data);
    const id = text(row.id) || text(data.id);
    const updatedAt = text(row.updated_at);
    if (!id || !updatedAt || seen.has(`${id}@${updatedAt}`)) return;
    if (canonicalReferenceCategory({ category: text(data.category) || text(row.category) }) !== 'drawing') return;
    if (CITATION_PAGE_INDEX_KEY in data || data.sourceProvider === 'google_drive') return;
    candidates.set(id, { updatedAt, data });
  });
  if (candidates.size === 0) return { written };
  const query = client as BackfillQuery;
  const { data: indexes, error } = await query.from('reference_documents')
    .select('id, updated_at, pages:document_data->extractedPages')
    .eq('owner_id', ownerId)
    .in('id', [...candidates.keys()]);
  if (error || !Array.isArray(indexes)) return { written };
  for (const value of indexes) {
    const read = record(value);
    const id = text(read.id);
    const listed = candidates.get(id);
    if (!listed) continue;
    seen.add(`${id}@${listed.updatedAt}`);
    // Changed since the list was read: the next list decides.
    if (text(read.updated_at) !== listed.updatedAt) continue;
    const pages = Array.isArray(read.pages) ? read.pages : [];
    const slice = pages.length > 0
      ? citationPageIndexOfTheRowsOwnIndex({ ...listed.data, extractedPages: pages } as unknown as ReferenceDocument)
      : null;
    // A drawing whose row holds no index: nothing is sent.
    if (!slice) continue;
    const { data: updated } = await query.from('reference_documents')
      .update({
        document_data: { ...listed.data, extractedPages: pages, [CITATION_PAGE_INDEX_KEY]: slice },
        updated_at: now(),
      })
      .eq('owner_id', ownerId)
      .eq('id', id)
      .eq('updated_at', listed.updatedAt)
      .select('updated_at')
      .maybeSingle();
    if (updated) written.push(id);
  }
  return { written };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
