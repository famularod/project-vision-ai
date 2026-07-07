import type { PIECoreOutput } from './PIECoreIntelligence';
import type { PIEExecutiveJudgmentRecord } from './PIEExecutiveJudgmentRepository';
import type { PIEReportDraft } from './PIEReporter';

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
  const record = input.executiveJudgmentRecord || input.core.executiveJudgmentRecord;
  if (!record) {
    throw new Error('Recommendation traceability requires a persisted Executive Judgment.');
  }
  return {
    userVisibleOutputId: input.report?.id || input.core.bestNextStep,
    executiveJudgmentId: record.id,
    realityModelId: record.realityModelId,
    realityModelVersion: record.realityModelVersion,
    realitySnapshotId: record.realitySnapshotId,
    realityObjectIds: record.supportingRealityObjectIds,
    assertionIds: record.supportingAssertionIds,
    evidenceIds: input.core.realityModel.objects
      .flatMap(object => object.sourceEvidenceReferences.map(reference => reference.evidenceId))
      .filter((id, index, all) => Boolean(id) && all.indexOf(id) === index),
    conflictIds: record.activeConflictIds,
    uncertaintyIds: record.activeUncertaintyIds,
    explanation: `${record.primaryRecommendation} is based on Reality Model ${record.realityModelVersion} and Executive Judgment ${record.id}.`,
  };
}
