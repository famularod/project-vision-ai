import type { PIECoreOutput } from './PIECoreIntelligence';
import type { PIEExecutiveJudgmentRecord } from './PIEExecutiveJudgmentRepository';
import type { PIEReportDraft } from './PIEReporter';
import {
  requireRealityModel,
  requireRealityOrExecutiveJudgment,
} from './PIERealityModelGuards';

export type PIERecommendationTrace = {
  userVisibleOutputId: string;
  executiveJudgmentId: string;
  realityModelId: string;
  realityModelVersion: number;
  realitySnapshotId: string;
  realityObjectIds: string[];
  assertionIds: string[];
  evidenceIds: string[];
  conflictIds: string[];
  uncertaintyIds: string[];
  explanation: string;
};

export function buildPIERecommendationTrace(input: {
  core: PIECoreOutput;
  report?: PIEReportDraft | null;
  executiveJudgmentRecord?: PIEExecutiveJudgmentRecord | null;
}): PIERecommendationTrace {
  const realityModel = requireRealityModel({
    realityModel: input.core.realityModel,
  });
  requireRealityOrExecutiveJudgment({
    realityModel,
    executiveJudgment: input.core.executiveJudgmentResult,
  });
  const record = input.executiveJudgmentRecord || input.core.executiveJudgmentRecord;
  if (!record) {
    throw new Error('Recommendation traceability requires a persisted Executive Judgment.');
  }
  const supportingObjectIds = new Set(record.supportingRealityObjectIds);
  const supportingObjects = realityModel.objects
    .filter(object => supportingObjectIds.has(object.identity.id));
  if (
    supportingObjectIds.size === 0 ||
    supportingObjects.length !== supportingObjectIds.size
  ) {
    throw new Error(
      'Recommendation traceability is incomplete because a supporting Reality object is missing.',
    );
  }
  const availableAssertionIds = new Set(
    supportingObjects.flatMap(object => object.assertions.map(assertion => assertion.id)),
  );
  if (
    record.supportingAssertionIds.length === 0 ||
    record.supportingAssertionIds.some(assertionId => !availableAssertionIds.has(assertionId))
  ) {
    throw new Error(
      'Recommendation traceability is incomplete because a supporting assertion is missing or outside the supporting Reality objects.',
    );
  }
  const evidenceIds = supportingObjects
    .flatMap(object =>
      object.sourceEvidenceReferences.map(reference => reference.evidenceId),
    )
    .filter((id, index, all) => Boolean(id) && all.indexOf(id) === index);
  if (evidenceIds.length === 0) {
    throw new Error(
      'Recommendation traceability is incomplete because no source evidence supports the judgment.',
    );
  }
  return {
    userVisibleOutputId: input.report?.id || input.core.bestNextStep,
    executiveJudgmentId: record.id,
    realityModelId: record.realityModelId,
    realityModelVersion: record.realityModelVersion,
    realitySnapshotId: record.realitySnapshotId,
    realityObjectIds: [...supportingObjectIds],
    assertionIds: [...record.supportingAssertionIds],
    // Audit P1-51: evidence in the trace flows only through the judgment's
    // supporting objects, keeping the trace consistent with the claim graph.
    evidenceIds,
    conflictIds: record.activeConflictIds,
    uncertaintyIds: record.activeUncertaintyIds,
    explanation: `${record.primaryRecommendation} is based on Reality Model ${record.realityModelVersion} and Executive Judgment ${record.id}.`,
  };
}
