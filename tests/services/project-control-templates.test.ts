import {
  applyProjectControlTemplate,
  applyProjectControlTemplateToControls,
  projectControlTemplate,
} from '../../services/ProjectControlTemplates';
import type { ScheduleItem } from '../../types';

const NOW = '2026-07-28T17:00:00.000Z';

function item(itemType: ScheduleItem['itemType']): ScheduleItem {
  return {
    id: `item-${itemType}`,
    itemType,
    scheduleProjectName: '2321 Compliance Project',
    projectName: '2321 Compliance Project',
    locationName: 'North Lot',
    taskName: `${itemType} record`,
    startDate: '2026-07-28',
    finishDate: '2026-07-30',
    milestone: '',
    owner: 'David',
    contractor: 'General contractor',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activity: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('Project control templates', () => {
  it('provides construction-specific setup for every new workflow type', () => {
    expect(projectControlTemplate('Meeting')).toMatchObject({
      title: 'Meeting and action items',
      checklist: expect.arrayContaining(['Record decisions made']),
    });
    expect(projectControlTemplate('Risk')).toMatchObject({
      title: 'Risk and mitigation',
      checklist: expect.arrayContaining(['Assign a mitigation owner']),
    });
    expect(projectControlTemplate('Transmittal')).toMatchObject({
      title: 'Controlled transmittal',
      workflowStage: 'Ready for Field',
    });
  });

  it('applies a setup without deleting existing controls or duplicating checks', () => {
    const source = item('RFI');
    source.projectControls = {
      version: 1,
      assignee: 'David',
      trade: 'Architect',
      watchers: ['Superintendent'],
      approvers: [],
      approvalStatus: 'Not Required',
      workflowStage: 'Open',
      referenceNumber: 'RFI-12',
      responseDueDate: '2026-07-30',
      checklist: [{
        id: 'existing',
        label: 'Record the question',
        completed: true,
        completedAt: NOW,
        completedBy: 'David',
      }],
      linkedRecords: [],
      resources: [],
      estimatedCostImpact: null,
      estimatedScheduleImpactDays: null,
      impactConfidence: 'Medium',
      impactNotes: '',
      revision: 1,
      updatedAt: NOW,
      updatedBy: 'David',
    };

    const result = applyProjectControlTemplate({
      item: source,
      actor: 'David',
      now: NOW,
      createId: (_label, index) => `check-${index}`,
    });

    expect(result.assignee).toBe('David');
    expect(result.trade).toBe('Architect');
    expect(result.referenceNumber).toBe('RFI-12');
    expect(result.workflowStage).toBe('Waiting on Response');
    expect(result.checklist.filter(check => check.label === 'Record the question')).toHaveLength(1);
    expect(result.checklist).toHaveLength(4);
  });

  it('never reopens a closed control record while adding missing template checks', () => {
    const source = item('Meeting');
    source.projectControls = {
      ...applyProjectControlTemplate({
        item: source,
        actor: 'David',
        now: NOW,
        createId: (_label, index) => `first-${index}`,
      }),
      workflowStage: 'Closed',
    };
    const result = applyProjectControlTemplate({
      item: source,
      actor: 'David',
      now: '2026-07-28T18:00:00.000Z',
      createId: (_label, index) => `second-${index}`,
    });
    expect(result.workflowStage).toBe('Closed');
    expect(result.checklist).toHaveLength(4);
  });

  it('creates field-ready controls without requiring a saved task first', () => {
    const result = applyProjectControlTemplateToControls({
      itemType: 'Meeting',
      actor: 'David',
      now: NOW,
      createId: (_label, index) => `meeting-${index}`,
    });

    expect(result.checklist.map(check => check.label)).toEqual([
      'Record attendees',
      'Record decisions made',
      'Assign every action item',
      'Distribute or link the meeting record',
    ]);
    expect(result.updatedBy).toBe('David');
  });
});
