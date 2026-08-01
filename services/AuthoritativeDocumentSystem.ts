import type {
  ReferenceDocument,
  ReferenceDocumentCitation,
  ReferenceDocumentRegion,
} from '../types';

const SCHEDULE_CATEGORIES = new Set(['schedule', 'schedules']);
const DRAWING_CATEGORIES = new Set(['drawing', 'plans']);

function compact(value: string | null | undefined) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function canonicalReferenceCategory(document: Pick<ReferenceDocument, 'category'>) {
  const category = compact(document.category);
  if (SCHEDULE_CATEGORIES.has(category)) return 'schedule';
  if (DRAWING_CATEGORIES.has(category)) return 'drawing';
  return category || 'other';
}

export function referenceDocumentProjectNames(
  document: Pick<ReferenceDocument, 'projectName' | 'projectNames'>,
) {
  return [...new Set([
    document.projectName,
    ...(document.projectNames || []),
  ].map(compact).filter(Boolean))];
}

export function referenceDocumentAppliesToProject(
  document: Pick<ReferenceDocument, 'projectName' | 'projectNames'>,
  projectName: string,
) {
  const projects = referenceDocumentProjectNames(document);
  return projects.length > 0 && projects.includes(compact(projectName));
}

function normalizedDocumentStem(document: Pick<
  ReferenceDocument,
  'name' | 'originalFileName' | 'drawingRevision'
>) {
  const withoutExtension = (document.originalFileName || document.name || '')
    .replace(/\.[^.]+$/, '');
  const revision = compact(document.drawingRevision);
  return compact(withoutExtension)
    .replace(/\b(?:rev(?:ision)?)[\s._-]*[a-z0-9]+\b/gi, '')
    .replace(revision ? new RegExp(`\\b${escapeRegExp(revision)}\\b`, 'gi') : /$^/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function referenceDocumentRevisionFamily(
  document: Pick<
    ReferenceDocument,
    | 'category'
    | 'name'
    | 'originalFileName'
    | 'drawingNumber'
    | 'drawingRevision'
    | 'webVersionGroupId'
  >,
) {
  const category = canonicalReferenceCategory(document);
  if (category === 'schedule') return 'schedule';
  if (category === 'drawing') {
    return compact(document.drawingNumber) ||
      compact(document.webVersionGroupId) ||
      normalizedDocumentStem(document) ||
      'drawing';
  }
  return compact(document.webVersionGroupId) ||
    normalizedDocumentStem(document) ||
    category;
}

export function markAuthoritativeDocumentCurrent(
  documents: ReferenceDocument[],
  targetId: string,
  updatedAt = new Date().toISOString(),
) {
  const target = documents.find(document => document.id === targetId);
  if (!target) return { documents, changedDocumentIds: [] as string[] };

  const targetCategory = canonicalReferenceCategory(target);
  const targetFamily = referenceDocumentRevisionFamily(target);
  const targetProjects = referenceDocumentProjectNames(target);
  if (targetProjects.length === 0) {
    return { documents, changedDocumentIds: [] as string[] };
  }
  const overlapsTargetProject = (document: ReferenceDocument) => {
    const projects = referenceDocumentProjectNames(document);
    return projects.length > 0 && projects.some(project => targetProjects.includes(project));
  };

  const changedDocumentIds: string[] = [];
  const next = documents.map(document => {
    const sameAuthoritySet =
      canonicalReferenceCategory(document) === targetCategory &&
      referenceDocumentRevisionFamily(document) === targetFamily &&
      overlapsTargetProject(document);
    if (!sameAuthoritySet) return document;
    const isCurrent = document.id === targetId;
    if (document.isCurrent === isCurrent) return document;
    changedDocumentIds.push(document.id);
    return { ...document, isCurrent, updatedAt };
  });
  return { documents: next, changedDocumentIds };
}

export function unmarkAuthoritativeDocumentCurrent(
  documents: ReferenceDocument[],
  targetId: string,
  updatedAt = new Date().toISOString(),
) {
  let changed = false;
  const next = documents.map(document => {
    if (document.id !== targetId || !document.isCurrent) return document;
    changed = true;
    return { ...document, isCurrent: false, updatedAt };
  });
  return { documents: next, changedDocumentIds: changed ? [targetId] : [] };
}

export function currentAuthoritativeDocumentsForProject(
  documents: ReferenceDocument[],
  projectName: string,
) {
  return documents.filter(document =>
    document.isCurrent && referenceDocumentAppliesToProject(document, projectName));
}

export function buildReferenceDocumentCitation(args: {
  document: ReferenceDocument;
  pageNumber?: number | null;
  sheetNumber?: string | null;
  regionId?: string | null;
}): ReferenceDocumentCitation {
  const revision = args.document.drawingRevision || null;
  const page = args.pageNumber || null;
  const sheet = args.sheetNumber || null;
  const parts = [
    args.document.name,
    revision ? `Rev ${revision}` : null,
    sheet ? `Sheet ${sheet}` : page ? `Page ${page}` : null,
  ].filter(Boolean);
  return {
    documentId: args.document.id,
    documentName: args.document.name,
    revision,
    pageNumber: page,
    sheetNumber: sheet,
    regionId: args.regionId || null,
    label: parts.join(' · '),
  };
}

export type AutomaticDrawingExcerpt = {
  document: ReferenceDocument;
  pageNumber: number;
  region: ReferenceDocumentRegion;
  citation: ReferenceDocumentCitation;
};

export function selectAutomaticDrawingExcerpt(args: {
  documents: ReferenceDocument[];
  projectName: string;
  areaName: string;
  minimumConfidence?: number;
}): AutomaticDrawingExcerpt | null {
  const area = compact(args.areaName);
  if (!area) return null;
  const minimumConfidence = args.minimumConfidence ?? 0.82;
  const drawings = currentAuthoritativeDocumentsForProject(
    args.documents,
    args.projectName,
  ).filter(document => canonicalReferenceCategory(document) === 'drawing');

  const candidates = drawings.flatMap(document =>
    (document.extractedPages || []).flatMap(page =>
      (page.regions || []).map(region => ({
        document,
        page,
        region,
        exactAreaMatch: (region.areaNames || []).some(name => compact(name) === area),
        labelMatch: compact(region.label) === area,
        confidence: region.confidence ?? 0,
      })),
    ),
  ).filter(candidate =>
    (candidate.exactAreaMatch || candidate.labelMatch) &&
    candidate.confidence >= minimumConfidence &&
    candidate.region.width > 0 &&
    candidate.region.height > 0);

  candidates.sort((left, right) =>
    Number(right.exactAreaMatch) - Number(left.exactAreaMatch) ||
    right.confidence - left.confidence);
  const selected = candidates[0];
  if (!selected) return null;
  return {
    document: selected.document,
    pageNumber: selected.page.pageNumber,
    region: selected.region,
    citation: buildReferenceDocumentCitation({
      document: selected.document,
      pageNumber: selected.page.pageNumber,
      sheetNumber: selected.page.sheetNumber,
      regionId: selected.region.id,
    }),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
