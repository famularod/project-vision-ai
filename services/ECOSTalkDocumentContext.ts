import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocument } from '../types';
import { routeDAVEAskIntent } from './DAVEAsk';
import {
  hydrateECOSDocumentsFromCloudSearch,
  searchECOSDocumentCloudIndex,
} from './ECOSDocumentCloudIndex';
import { hasECOSHostedCommitReceipt } from './ECOSHostedPageGraphAuthority';

type LoadECOSTalkReferenceDocumentsInput = Readonly<{
  client: SupabaseClient | null;
  documents: readonly ReferenceDocument[];
  projectId: string;
  projectName: string;
  question: string;
}>;

/**
 * Replaces synchronized page JSON with only the exact protected cloud chunks
 * needed for this Talk question. A hosted receipt never makes a client-authored
 * local graph authoritative; cloud failure therefore leaves metadata only.
 */
export async function loadECOSTalkReferenceDocuments({
  client,
  documents,
  projectId,
  projectName,
  question,
}: LoadECOSTalkReferenceDocumentsInput): Promise<readonly ReferenceDocument[]> {
  const normalizedProject = projectName.trim().toLowerCase();
  const legacyProjectId = projectAuthorityId(projectName);
  const hostedCandidates = documents.filter(document => {
    const projects = [document.projectName || '', ...(document.projectNames || [])]
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    const exactProject = document.projectId === projectId;
    const legacyProject = projectId === legacyProjectId && projects.includes(normalizedProject);
    return (exactProject || legacyProject) &&
      document.isCurrent &&
      hasECOSHostedCommitReceipt(document);
  });
  const hostedIds = new Set(hostedCandidates.map(document => document.id));
  const metadataOnly = documents.map(document => hostedIds.has(document.id)
    ? { ...document, extractedPages: [], extractedText: null }
    : document);
  if (!client || hostedCandidates.length === 0 || !talkQuestionNeedsDocumentAnswer(question)) {
    return metadataOnly;
  }
  try {
    const rows = await searchECOSDocumentCloudIndex({
      client,
      question,
      documentIds: hostedCandidates.map(document => document.id),
      maximumResults: 24,
    });
    return hydrateECOSDocumentsFromCloudSearch(metadataOnly, rows);
  } catch {
    return metadataOnly;
  }
}

function projectAuthorityId(projectName: string) {
  const normalized = projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `project-${normalized || 'unassigned'}`;
}

export function talkQuestionNeedsDocumentAnswer(value: string) {
  const normalized = value.trim().toLowerCase();
  return routeDAVEAskIntent(normalized) !== 'unknown' ||
    value.trim().endsWith('?') ||
    /^(?:what|why|how|when|where|which|who|is|are|can|could|should|show|find|tell me|explain)\b/.test(normalized);
}
