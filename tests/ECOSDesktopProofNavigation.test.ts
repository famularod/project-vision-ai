import {
  buildECOSDesktopDocumentProofParams,
  evaluateECOSDesktopDocumentProofBinding,
  parseECOSDesktopDocumentProofFocus,
  resolveECOSDesktopDocumentProof,
} from '../services/ECOSDesktopProofNavigation';
import type { DAVEAskEvidence } from '../services/DAVEAsk';
import type { ReferenceDocument } from '../types';

const SOURCE_SHA = 'eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01';
const PROJECT_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const REGION_ID = 'structured-table-fact:relationship:24bf97ccee6a45baca12ec44';
const BOUNDS = Object.freeze({ x: 0.608889, y: 0.172222, width: 0.085, height: 0.009167 });
const PROJECTS = Object.freeze([{ id: PROJECT_ID, name: '2375 Compliance Project' }]);

const evidence: DAVEAskEvidence = {
  sourceType: 'document',
  recordId: 'web-document-edb4a270-4a4e-463f-90fc-e378dd23dd3c',
  summary: 'Civil drawing, Sheet C6',
  timelineEventId: null,
  excerpt: '6.0” THICK 6.0” PCC PAVING',
  documentCitation: {
    documentId: 'web-document-edb4a270-4a4e-463f-90fc-e378dd23dd3c',
    projectId: PROJECT_ID,
    sourceSha256: SOURCE_SHA,
    evidenceVersion: EVIDENCE_VERSION,
    documentName: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
    revision: '1',
    pageNumber: 6,
    sheetNumber: 'C6',
    regionId: REGION_ID,
    label: 'Civil drawing, Sheet C6, PDF page 6',
  },
  documentRegion: {
    id: REGION_ID,
    text: '6.0” THICK 6.0” PCC PAVING',
    ...BOUNDS,
    source: 'ocr',
  },
};

const hostedDocument: ReferenceDocument = {
  id: 'web-document-edb4a270-4a4e-463f-90fc-e378dd23dd3c',
  name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
  originalFileName: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL.pdf',
  uri: '',
  mimeType: 'application/pdf',
  category: 'Drawing',
  notes: '',
  isCurrent: true,
  importedAt: '2026-08-01T00:00:00.000Z',
  projectId: PROJECT_ID,
  projectName: '2375 Compliance Project',
  contentSha256: SOURCE_SHA,
  webFileFingerprint: SOURCE_SHA,
  indexedContentSha256: SOURCE_SHA,
  ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
  ecosVerifiedIndexCommittedSha256: SOURCE_SHA,
  ecosVerifiedIndexCommittedPageCount: 8,
  sourcePageCount: 8,
  drawingRevision: '1',
  ecosHostedIndexEvidenceVersion: EVIDENCE_VERSION,
  extractedPages: [{
    pageNumber: 6,
    sheetNumber: 'C6',
    sheetMappingStatus: 'verified',
    assurance: {
      accepted: true,
      evidenceVersion: EVIDENCE_VERSION,
      failureCodes: [],
    },
  }],
};

describe('ECOS desktop proof navigation', () => {
  it('builds an exact source-bound route without putting evidence text in the URL', () => {
    const params = buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project');

    expect(params).toEqual({
      project: '2375 Compliance Project',
      proofDocument: hostedDocument.id,
      proofProjectId: PROJECT_ID,
      proofSourceSha256: SOURCE_SHA,
      proofEvidenceVersion: EVIDENCE_VERSION,
      proofRevision: '1',
      proofPage: '6',
      proofRegion: REGION_ID,
      proofSheet: 'C6',
      proofX: '0.608889',
      proofY: '0.172222',
      proofWidth: '0.085',
      proofHeight: '0.009167',
    });
    expect(JSON.stringify(params)).not.toContain('6.0” THICK');
  });

  it('requires exact document, project, source, evidence, revision, and page identity', () => {
    const exact = buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project');
    for (const key of [
      'proofDocument',
      'proofProjectId',
      'proofSourceSha256',
      'proofEvidenceVersion',
      'proofRevision',
      'proofPage',
    ]) {
      expect(parseECOSDesktopDocumentProofFocus({ ...exact, [key]: undefined })).toBeNull();
    }
    expect(parseECOSDesktopDocumentProofFocus({ ...exact, proofPage: '0' })).toBeNull();
    expect(parseECOSDesktopDocumentProofFocus({ ...exact, proofDocument: `${hostedDocument.id}\nforged` })).toBeNull();
  });

  it('drops partial or out-of-page bounds while retaining exact page focus', () => {
    const exact = buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project');
    const partial = parseECOSDesktopDocumentProofFocus({
      ...exact,
      proofX: '0.1',
      proofY: '0.2',
      proofWidth: undefined,
      proofHeight: undefined,
    });
    const outside = parseECOSDesktopDocumentProofFocus({
      ...exact,
      proofX: '0.9',
      proofY: '0.2',
      proofWidth: '0.2',
      proofHeight: '0.1',
    });

    expect(partial?.bounds).toBeNull();
    expect(outside?.bounds).toBeNull();
  });

  it('opens the bounded hosted V2 citation without requiring the older six-tile visual index', () => {
    const focus = parseECOSDesktopDocumentProofFocus(
      buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project'),
    );
    expect(focus).not.toBeNull();

    const resolved = resolveECOSDesktopDocumentProof([hostedDocument], focus!, PROJECTS);
    expect(resolved).toMatchObject({
      match: 'hosted_cited_bounds',
      region: null,
      bounds: BOUNDS,
      binding: {
        exact: true,
        reason: 'exact_hosted_region',
        proofMode: 'hosted_cited_region',
      },
    });
  });

  it('still resolves an exact stored region when the current document carries it', () => {
    const storedDocument: ReferenceDocument = {
      ...hostedDocument,
      category: 'Report',
      extractedPages: [{
        ...hostedDocument.extractedPages![0],
        regions: [{ id: REGION_ID, text: evidence.excerpt, ...BOUNDS, source: 'ocr' }],
      }],
    };
    const focus = parseECOSDesktopDocumentProofFocus(
      buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project'),
    );
    const resolved = resolveECOSDesktopDocumentProof([storedDocument], focus!, PROJECTS);
    expect(resolved?.match).toBe('stored_region');
    expect(resolved?.region?.id).toBe(REGION_ID);
    expect(resolved?.bounds).toEqual(BOUNDS);
  });

  it.each([
    ['project', { projectId: 'project-forged' }, {}, 'project_scope_mismatch'],
    ['source', { sourceSha256: 'f'.repeat(64) }, {}, 'source_mismatch'],
    ['revision', { revision: '2' }, {}, 'revision_mismatch'],
    ['page', { pageNumber: 7 }, {}, 'page_mismatch'],
    ['sheet', { sheetNumber: 'C5' }, {}, 'sheet_mismatch'],
    ['evidence version', { evidenceVersion: 'ecos-hosted-evidence/1.2' }, {}, 'evidence_version_mismatch'],
    ['current status', {}, { isCurrent: false }, 'document_not_current'],
  ])('fails closed when %s identity drifts', (_label, focusPatch, documentPatch, reason) => {
    const focus = parseECOSDesktopDocumentProofFocus(
      buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project'),
    )!;
    const driftedFocus = Object.freeze({ ...focus, ...focusPatch });
    const driftedDocument = { ...hostedDocument, ...documentPatch };
    expect(evaluateECOSDesktopDocumentProofBinding(driftedDocument, driftedFocus, PROJECTS)).toMatchObject({
      exact: false,
      reason,
    });
    expect(resolveECOSDesktopDocumentProof([driftedDocument], driftedFocus, PROJECTS)).toBeNull();
  });

  it('never opens a document outside the authorized project-scoped list', () => {
    const focus = parseECOSDesktopDocumentProofFocus(
      buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project'),
    )!;
    expect(resolveECOSDesktopDocumentProof([], focus, PROJECTS)).toBeNull();
  });
});
