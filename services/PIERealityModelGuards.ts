import type { PIEExecutiveJudgmentResult } from './PIEExecutiveJudgment';
import type { PIERealityModel } from './PIERealityModel';

export type RealityFirstInput = {
  realityModel: PIERealityModel;
};

export type RealityOrExecutiveJudgmentInput = {
  realityModel?: PIERealityModel | null;
  executiveJudgment?: PIEExecutiveJudgmentResult | null;
};

export function requireRealityModel<T extends RealityFirstInput>(input: T): PIERealityModel {
  if (!input.realityModel) {
    throw new Error('Reality-first intelligence requires an authoritative Reality Model.');
  }
  return input.realityModel;
}

export function requireRealityOrExecutiveJudgment(
  input: RealityOrExecutiveJudgmentInput,
): void {
  if (!input.realityModel && !input.executiveJudgment) {
    throw new Error('Downstream DAVE intelligence requires Reality Model or Layer 3 Executive Judgment input.');
  }
}

export const DEPRECATED_RAW_EVIDENCE_REPORTER_PATH =
  'Deprecated compatibility path: Reporter may accept raw evidence only while migrating to Reality-first communication.';

export const DEPRECATED_REPORT_TO_LAYER4_PATH =
  'Deprecated compatibility path: Layer 4 decision candidates must move from report drafts to structured Executive Judgment.';
