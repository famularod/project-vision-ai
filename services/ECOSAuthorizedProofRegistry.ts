import type { DAVEAskEvidence } from './DAVEAsk';
import type { ReferenceDocument } from '../types';

type ProofIdentity = Readonly<{
  documentId: string; projectId: string; sourceSha256: string;
  evidenceVersion: string; revision: string; pageNumber: number;
  sheetNumber: string | null; regionId: string | null;
}>;
// Ephemeral authority for exactly one server-verified proof, never a document
// publication or whole-document indexing receipt. Uploaded JSON cannot forge it.
const authorized = new WeakMap<ReferenceDocument, ProofIdentity>();
export function registerECOSAuthorizedProof(document: ReferenceDocument, claim: ProofIdentity) {
  authorized.set(document, Object.freeze({ ...claim }));
}
export function hasECOSAuthorizedProof(document: ReferenceDocument, evidence: DAVEAskEvidence): boolean {
  const claim = authorized.get(document), citation = evidence.documentCitation;
  if (!claim || !citation) return false;
  return claim.documentId === citation.documentId && claim.projectId === citation.projectId &&
    claim.sourceSha256 === citation.sourceSha256 && claim.evidenceVersion === citation.evidenceVersion &&
    claim.revision === citation.revision && claim.pageNumber === citation.pageNumber &&
    (claim.sheetNumber || null) === (citation.sheetNumber || null) &&
    (claim.regionId || null) === (citation.regionId || null);
}
