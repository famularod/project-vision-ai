import type { ReferenceDocument } from '../types';
import { buildECOSDocumentReadiness } from './ECOSDocumentReadiness';

export const ECOS_CUSTOMER_DOCUMENT_STATUSES = Object.freeze([
  'Waiting',
  'Preparing',
  'Prepared',
  'Prepared with limitations',
  'Ready for ECOS',
  'Ready with limitations',
  'Needs Review',
  'Reconnect Files',
  'Temporarily Unavailable',
] as const);

export type ECOSCustomerDocumentStatus = typeof ECOS_CUSTOMER_DOCUMENT_STATUSES[number];

export type ECOSDocumentOnboardingStatusCount = Readonly<{
  status: ECOSCustomerDocumentStatus;
  count: number;
  limitationCount: number;
  message: string;
}>;

export type ECOSDocumentOnboardingSummary = Readonly<{
  total: number;
  headline: string;
  detail: string;
  readyCount: number;
  preparingCount: number;
  preparedCount: number;
  limitationCount: number;
  reviewCount: number;
  reconnectCount: number;
  unavailableCount: number;
  statusCounts: readonly ECOSDocumentOnboardingStatusCount[];
}>;

const STATUS_MESSAGES: Record<ECOSCustomerDocumentStatus, string> = {
  Waiting: 'Added to the project and waiting for preparation to begin.',
  Preparing: 'Vitruvius is preparing this document in the background.',
  Prepared: 'Background preparation passed. Make this exact revision current before Ask ECOS can use it.',
  'Prepared with limitations': 'Background preparation passed with items to review before or after activating this exact revision.',
  'Ready for ECOS': 'Ready for questions with verified project evidence.',
  'Ready with limitations': 'Ready for questions using verified evidence, with listed limitations that still need review.',
  'Needs Review': 'Check only the highlighted details before ECOS uses this document.',
  'Reconnect Files': 'Reconnect access to this source file so Vitruvius can continue.',
  'Temporarily Unavailable': 'Preparation is paused and will resume automatically.',
};

export function resolveECOSCustomerDocumentStatus(
  document: ReferenceDocument,
): ECOSCustomerDocumentStatus {
  const hostedStatus = document.ecosHostedIndexStatus;
  const readiness = buildECOSDocumentReadiness(document);
  if (readiness.status === 'stale' && document.contentSha256 && document.indexedContentSha256 &&
      document.contentSha256.toLowerCase() !== document.indexedContentSha256.toLowerCase()) return 'Preparing';
  if (readiness.status === 'needs_metadata') return 'Needs Review';
  if (hostedStatus === 'Ready for ECOS' && !document.isCurrent) return 'Prepared';
  if (hostedStatus === 'Ready with limitations' && !document.isCurrent) return 'Prepared with limitations';
  if (hostedStatus && ECOS_CUSTOMER_DOCUMENT_STATUSES.includes(hostedStatus)) {
    return hostedStatus;
  }

  if (
    readiness.status === 'failed' ||
    readiness.status === 'not_supported' ||
    readiness.status === 'ready_with_limitations'
  ) {
    return 'Needs Review';
  }
  if (readiness.status === 'ready') {
    return 'Ready for ECOS';
  }
  if (readiness.status === 'not_current') return 'Needs Review';
  if (
    readiness.status === 'pending' &&
    !document.indexedAt &&
    !document.searchablePageCount
  ) {
    return 'Waiting';
  }
  return 'Preparing';
}

export function buildECOSDocumentOnboardingSummary(
  documents: readonly ReferenceDocument[],
): ECOSDocumentOnboardingSummary {
  const counts = new Map<ECOSCustomerDocumentStatus, number>(
    ECOS_CUSTOMER_DOCUMENT_STATUSES.map(status => [status, 0]),
  );
  const limitationCounts = new Map<ECOSCustomerDocumentStatus, number>(
    ECOS_CUSTOMER_DOCUMENT_STATUSES.map(status => [status, 0]),
  );
  documents.forEach(document => {
    const status = resolveECOSCustomerDocumentStatus(document);
    counts.set(status, (counts.get(status) ?? 0) + 1);
    limitationCounts.set(
      status,
      (limitationCounts.get(status) ?? 0) +
        Math.max(0, Math.floor(document.ecosHostedIndexLimitationCount ?? 0)),
    );
  });

  const readyCount = (counts.get('Ready for ECOS') ?? 0) +
    (counts.get('Ready with limitations') ?? 0);
  const preparingCount = (counts.get('Waiting') ?? 0) + (counts.get('Preparing') ?? 0);
  const preparedCount = (counts.get('Prepared') ?? 0) +
    (counts.get('Prepared with limitations') ?? 0);
  const limitationCount = documents.reduce((sum, document) =>
    sum + Math.max(0, Math.floor(document.ecosHostedIndexLimitationCount ?? 0)), 0);
  const reviewCount = (counts.get('Needs Review') ?? 0) +
    (counts.get('Prepared with limitations') ?? 0) +
    (counts.get('Ready with limitations') ?? 0);
  const reconnectCount = counts.get('Reconnect Files') ?? 0;
  const unavailableCount = counts.get('Temporarily Unavailable') ?? 0;
  const statusCounts = ECOS_CUSTOMER_DOCUMENT_STATUSES
    .map(status => {
      const statusLimitationCount = limitationCounts.get(status) ?? 0;
      return Object.freeze({
        status,
        count: counts.get(status) ?? 0,
        limitationCount: statusLimitationCount,
        message: statusLimitationCount > 0 && (
          status === 'Prepared with limitations' || status === 'Ready with limitations'
        )
          ? `${statusLimitationCount} accepted page${statusLimitationCount === 1 ? '' : 's'} passed ECOS Assurance with review limitations.`
          : STATUS_MESSAGES[status],
      });
    })
    .filter(item => item.count > 0);

  let headline = 'Add project documents to begin';
  let detail = 'Vitruvius will organize and prepare the selected files for ECOS.';
  if (documents.length > 0 && reviewCount + reconnectCount > 0) {
    headline = 'A few document details need your review';
    detail = 'Review only the highlighted items. Other documents will keep preparing in the background.';
  } else if (documents.length > 0 && preparingCount > 0) {
    headline = 'Vitruvius is preparing your project documents';
    detail = 'You can leave this page. Preparation continues in the background and completed work is saved.';
  } else if (documents.length > 0 && preparedCount > 0) {
    headline = 'Project documents are prepared and awaiting activation';
    detail = 'Make the reviewed revision current before Ask ECOS can use its verified evidence.';
  } else if (documents.length > 0 && unavailableCount > 0) {
    headline = 'Document preparation will resume automatically';
    detail = 'Your files are safe. Vitruvius will continue when document preparation is available again.';
  } else if (documents.length > 0 && readyCount === documents.length) {
    headline = 'Project documents are ready for ECOS';
    detail = 'Ask a project question and open the cited proof to verify the answer.';
  }

  return Object.freeze({
    total: documents.length,
    headline,
    detail,
    readyCount,
    preparingCount,
    preparedCount,
    limitationCount,
    reviewCount,
    reconnectCount,
    unavailableCount,
    statusCounts: Object.freeze(statusCounts),
  });
}
