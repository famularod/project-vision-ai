import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocument } from '../types';
import { routeDAVEAskIntent } from './DAVEAsk';
import {
  hydrateECOSDocumentsFromCloudSearch,
  searchECOSDocumentCloudIndex,
} from './ECOSDocumentCloudIndex';
import { buildECOSDocumentReadiness } from './ECOSDocumentReadiness';

type LoadECOSTalkReferenceDocumentsInput = Readonly<{
  client: SupabaseClient | null;
  documents: readonly ReferenceDocument[];
  projectName: string;
  question: string;
}>;

/**
 * Adds only the protected cloud chunks needed for a Talk question when the
 * synchronized document metadata is present but its page index is not local.
 * Local pages remain the offline-first source and any cloud failure fails
 * closed to the unchanged local document set.
 */
export async function loadECOSTalkReferenceDocuments({
  client,
  documents,
  projectName,
  question,
}: LoadECOSTalkReferenceDocumentsInput): Promise<readonly ReferenceDocument[]> {
  const normalizedProject = projectName.trim().toLowerCase();
  const metadataOnlyCandidates = documents.filter(document => {
    const projects = [document.projectName || '', ...(document.projectNames || [])]
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    return projects.includes(normalizedProject) &&
      (document.extractedPages ?? []).length === 0 &&
      buildECOSDocumentReadiness(document).eligibleForAnswers;
  });
  if (!client || metadataOnlyCandidates.length === 0 || !talkQuestionNeedsDocumentAnswer(question)) {
    return documents;
  }
  try {
    const rows = await searchECOSDocumentCloudIndex({
      client,
      question,
      documentIds: metadataOnlyCandidates.map(document => document.id),
      maximumResults: 24,
    });
    return hydrateECOSDocumentsFromCloudSearch(documents, rows);
  } catch {
    return documents;
  }
}

export function talkQuestionNeedsDocumentAnswer(value: string) {
  const normalized = value.trim().toLowerCase();
  return routeDAVEAskIntent(normalized) !== 'unknown' ||
    value.trim().endsWith('?') ||
    /^(?:what|why|how|when|where|which|who|is|are|can|could|should|show|find|tell me|explain)\b/.test(normalized);
}
