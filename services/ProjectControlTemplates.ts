import type {
  ProjectControlApprovalStatus,
  ProjectControlChecklistItem,
  ProjectControlWorkflowStage,
  ProjectControls,
  ProjectItemType,
  ScheduleItem,
} from '../types';
import {
  createProjectControlChecklistItem,
  normalizeProjectControls,
  reviseProjectControls,
} from './VitruviusProjectControls';

export type ProjectControlTemplate = Readonly<{
  itemType: ProjectItemType;
  title: string;
  purpose: string;
  workflowStage: ProjectControlWorkflowStage;
  approvalStatus: ProjectControlApprovalStatus;
  checklist: readonly string[];
}>;

const TEMPLATES: Readonly<Record<ProjectItemType, ProjectControlTemplate>> = {
  Task: template('Task', 'Task delivery', 'Track planned work, responsibility, and field progress.', []),
  Issue: template('Issue', 'Issue resolution', 'Assign the issue, document the response, and verify resolution.', [
    'Confirm the current condition',
    'Assign the next action',
    'Verify the resolution in the field',
  ]),
  RFI: template('RFI', 'Request for information', 'Track the question, responsible responder, due date, and accepted answer.', [
    'Record the question',
    'Identify the required responder',
    'Link the response or supporting drawing',
    'Confirm the answer was communicated to the field',
  ], 'Waiting on Response'),
  Submittal: template('Submittal', 'Submittal review', 'Track preparation, review, approval, and release to the field.', [
    'Confirm the required specification or drawing',
    'Record the submitted package',
    'Complete the review',
    'Release the approved information to the field',
  ], 'In Review', 'Draft'),
  Transmittal: template('Transmittal', 'Controlled transmittal', 'Record what was issued, to whom, and the current revision.', [
    'Identify every recipient',
    'Link the issued documents',
    'Confirm the correct revisions',
    'Record delivery or receipt',
  ], 'Ready for Field'),
  'Punch List': template('Punch List', 'Punch-list correction', 'Assign the deficiency, verify correction, and retain closeout evidence.', [
    'Describe the deficiency',
    'Assign the responsible trade',
    'Complete the correction',
    'Verify the corrected condition',
  ]),
  Decision: template('Decision', 'Project decision', 'Document the decision, required approval, and field communication.', [
    'State the decision required',
    'Identify the decision maker',
    'Record the decision',
    'Communicate the decision to affected parties',
  ], 'In Review'),
  Inspection: template('Inspection', 'Inspection record', 'Prepare, perform, and close an inspection with a retained result.', [
    'Confirm the inspection scope',
    'Record the inspection result',
    'Document deficiencies or follow-up',
    'Link supporting photos or documents',
  ], 'Ready for Field'),
  'Daily Log': template('Daily Log', 'Daily field log', 'Capture the day’s work, workforce, equipment, conditions, and constraints.', [
    'Record work performed',
    'Record crews and equipment',
    'Record delays, constraints, or safety events',
    'Confirm the daily summary',
  ]),
  Meeting: template('Meeting', 'Meeting and action items', 'Retain attendees, decisions, action items, owners, and due dates.', [
    'Record attendees',
    'Record decisions made',
    'Assign every action item',
    'Distribute or link the meeting record',
  ]),
  Risk: template('Risk', 'Risk and mitigation', 'Assign the risk, record likely impact, and track mitigation to closure.', [
    'Describe the risk and trigger',
    'Record the likely schedule or field impact',
    'Assign a mitigation owner',
    'Verify the mitigation is complete',
  ], 'Open'),
  'Safety Observation': template('Safety Observation', 'Safety observation', 'Record the condition, immediate control, owner, and verification.', [
    'Describe the observed condition',
    'Record the immediate control',
    'Assign corrective action',
    'Verify the safe condition',
  ]),
  'Quality Check': template('Quality Check', 'Quality-control check', 'Verify the work against the approved requirement and retain the result.', [
    'Identify the governing requirement',
    'Perform the quality check',
    'Record deficiencies and correction',
    'Verify final acceptance',
  ], 'Ready for Field'),
};

export function projectControlTemplate(
  itemType: ProjectItemType | null | undefined,
): ProjectControlTemplate {
  return TEMPLATES[itemType && itemType in TEMPLATES ? itemType : 'Task'];
}

export function applyProjectControlTemplate({
  item,
  actor,
  now,
  createId = defaultId,
}: {
  item: ScheduleItem;
  actor: string;
  now: string;
  createId?: (label: string, index: number) => string;
}): ProjectControls {
  return applyProjectControlTemplateToControls({
    itemType: item.itemType,
    current: item.projectControls,
    actor,
    now,
    createId,
  });
}

export function applyProjectControlTemplateToControls({
  itemType,
  current,
  actor,
  now,
  createId = defaultId,
}: {
  itemType: ProjectItemType | null | undefined;
  current?: ProjectControls | null;
  actor: string;
  now: string;
  createId?: (label: string, index: number) => string;
}): ProjectControls {
  const controls = normalizeProjectControls(current);
  const selected = projectControlTemplate(itemType);
  const existingLabels = new Set(
    controls.checklist.map(check => canonical(check.label)),
  );
  const additions = selected.checklist.flatMap((label, index) => {
    if (existingLabels.has(canonical(label))) return [];
    const check = createProjectControlChecklistItem({
      label,
      id: createId(label, index),
    });
    return check ? [check] : [];
  });

  return reviseProjectControls({
    current: controls,
    patch: {
      workflowStage: controls.workflowStage === 'Closed'
        ? controls.workflowStage
        : selected.workflowStage,
      approvalStatus: controls.approvalStatus === 'Not Required'
        ? selected.approvalStatus
        : controls.approvalStatus,
      checklist: [
        ...controls.checklist.map(cloneChecklist),
        ...additions,
      ],
    },
    actor,
    now,
  });
}

function template(
  itemType: ProjectItemType,
  title: string,
  purpose: string,
  checklist: readonly string[],
  workflowStage: ProjectControlWorkflowStage = 'Open',
  approvalStatus: ProjectControlApprovalStatus = 'Not Required',
): ProjectControlTemplate {
  return {
    itemType,
    title,
    purpose,
    checklist,
    workflowStage,
    approvalStatus,
  };
}

function canonical(value: string) {
  return value.trim().toLocaleLowerCase();
}

function cloneChecklist(item: ProjectControlChecklistItem): ProjectControlChecklistItem {
  return { ...item };
}

function defaultId(_label: string, index: number) {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `template-check-${globalThis.crypto.randomUUID()}`;
  }
  return `template-check-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}
