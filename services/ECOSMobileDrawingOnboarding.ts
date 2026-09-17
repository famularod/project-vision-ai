import type { ReferenceDocument } from '../types';
import { suggestECOSDrawingIntake } from './ECOSDocumentUploadIntake';

export type ECOSMobileDrawingControls = Readonly<{
  drawingNumber: string;
  drawingRevision: string;
  drawingDiscipline: string;
  drawingStatus: NonNullable<ReferenceDocument['drawingStatus']>;
  drawingIssuedAt: string;
  replacementDocumentId: string | null;
}>;

export type ECOSMobileDrawingControlValidation = Readonly<{
  valid: boolean;
  missingFields: readonly string[];
  invalidFields: readonly string[];
  message: string | null;
}>;

export function createECOSMobileDrawingControls(fileName = ''): ECOSMobileDrawingControls {
  return Object.freeze({
    drawingStatus: 'For Review',
    drawingIssuedAt: '',
    replacementDocumentId: null,
    ...suggestECOSDrawingIntake(fileName),
  });
}

export function validateECOSMobileDrawingControls(
  controls: ECOSMobileDrawingControls,
): ECOSMobileDrawingControlValidation {
  const missingFields = [
    controls.drawingNumber.trim() ? null : 'drawing number',
    controls.drawingRevision.trim() ? null : 'revision',
    controls.drawingStatus ? null : 'issue status',
  ].filter((value): value is string => Boolean(value));
  const invalidFields = controls.drawingIssuedAt.trim() &&
    !isISOCalendarDate(controls.drawingIssuedAt.trim())
    ? ['issue date']
    : [];
  const valid = missingFields.length === 0 && invalidFields.length === 0;
  const problems = [
    missingFields.length > 0 ? `add ${humanList(missingFields)}` : null,
    invalidFields.length > 0 ? 'use YYYY-MM-DD for the issue date' : null,
  ].filter((value): value is string => Boolean(value));

  return Object.freeze({
    valid,
    missingFields: Object.freeze(missingFields),
    invalidFields: Object.freeze(invalidFields),
    message: valid ? null : `Before adding this drawing, ${humanList(problems)}.`,
  });
}

export function mobileDrawingMetadataForUpload(
  controls: ECOSMobileDrawingControls,
  replacement: Pick<ReferenceDocument, 'id' | 'webVersionGroupId' | 'drawingNumber'> | null,
) {
  return Object.freeze({
    drawingNumber: controls.drawingNumber.trim(),
    drawingRevision: controls.drawingRevision.trim(),
    drawingDiscipline: controls.drawingDiscipline.trim() || null,
    drawingStatus: controls.drawingStatus,
    drawingIssuedAt: controls.drawingIssuedAt.trim() || null,
    // Match the authority-family resolver used by Make Current: explicit
    // family first, then the controlled drawing number, then stable identity.
    // This also keeps older mobile drawings (which predate version-group
    // metadata) in the same safe revision family.
    webVersionGroupId: replacement?.webVersionGroupId?.trim() ||
      replacement?.drawingNumber?.trim().toLowerCase() ||
      replacement?.id ||
      null,
  });
}

function isISOCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function humanList(items: readonly string[]) {
  if (items.length <= 1) return items[0] || 'the required details';
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}
