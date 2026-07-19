import type { ScheduleItem } from '../../types';
import { buildPIEKnowledgeGraph } from '../../services/PIEKnowledgeGraph';
import {
  buildMission,
  buildProjectMission,
} from '../../services/PIEMissionEngine';

const NOW = new Date('2026-07-18T12:00:00-07:00');

function scheduleItem(
  overrides: Partial<ScheduleItem> = {},
): ScheduleItem {
  return {
    id: 'schedule-1',
    projectName: '2375 Compliance Project',
    scheduleProjectName: '2375 Compliance Project',
    locationName: 'Canopy A',
    taskName: 'Install wall packs',
    startDate: '2026-07-17',
    finishDate: '2026-07-25T17:00:00-07:00',
    milestone: '',
    owner: 'Project manager',
    contractor: 'Electrical contractor',
    percentComplete: 20,
    priority: 'High',
    status: 'In Progress',
    notes: '',
    createdAt: '2026-07-17T08:00:00-07:00',
    ...overrides,
  };
}

function graphFor(item: ScheduleItem) {
  return buildPIEKnowledgeGraph({
    projectName: item.projectName,
    projectNames: [item.projectName],
    scheduleItems: [item],
    now: NOW,
  });
}

describe('mission and knowledge-graph authority', () => {
  it('does not fabricate a blocker edge or recovery mission from High priority alone', () => {
    const graph = graphFor(scheduleItem());

    expect(graph.relationships.filter(item => item.edgeType === 'blocks')).toEqual([]);
    expect(buildProjectMission({
      projectName: graph.projectName,
      knowledgeGraph: graph,
      now: NOW,
    }).missionType).not.toBe('schedule-recovery');
  });

  it.each([
    scheduleItem({ status: 'Waiting', priority: 'Low' }),
    scheduleItem({ notes: 'Blocked by an unresolved electrical shutdown.', priority: 'Low' }),
  ])('creates recovery authority only for explicit waiting or blocker evidence', item => {
    const graph = graphFor(item);

    expect(graph.relationships.some(relationship => relationship.edgeType === 'blocks')).toBe(true);
    expect(buildProjectMission({
      projectName: graph.projectName,
      knowledgeGraph: graph,
      now: NOW,
    }).missionType).toBe('schedule-recovery');
  });

  it('does not fabricate a dependency edge merely because a task is overdue', () => {
    const graph = graphFor(scheduleItem({
      finishDate: '2026-07-17T17:00:00-07:00',
      priority: 'Low',
    }));

    expect(graph.relationships.filter(item => item.edgeType === 'blocks')).toEqual([]);
    expect(buildProjectMission({
      projectName: graph.projectName,
      knowledgeGraph: graph,
      now: NOW,
    }).missionType).not.toBe('schedule-recovery');
  });

  it('honors explicit no-blocker language instead of the blocker keyword', () => {
    const graph = graphFor(scheduleItem({
      priority: 'Low',
      notes: 'No blocker is present. Work is proceeding as planned.',
    }));

    expect(graph.relationships.filter(item => item.edgeType === 'blocks')).toEqual([]);
  });

  it.each([
    ['safety-verification', 'Safety concern evidence is reviewed.'],
    ['issue-investigation', 'Issue evidence is connected.'],
    ['inspection-verification', 'Inspection status is known or explicitly marked unknown.'],
  ] as const)(
    'does not let the %s criterion description satisfy itself with zero typed evidence',
    (missionType, criterionDescription) => {
      const mission = buildMission({
        missionType,
        projectName: '2375 Compliance Project',
        now: NOW,
      });
      const criterion = mission.successCriteria.find(
        item => item.description === criterionDescription,
      );

      expect(criterion).toBeDefined();
      expect(criterion?.met).toBe(false);
      expect(criterion?.evidence).not.toContain(criterionDescription);
    },
  );

  it.each([
    ['No safety issues were observed.', 'safety-verification'],
    ['No current issues were observed and no blocker is present.', 'issue-investigation'],
  ] as const)('does not select %s wording as an active mission', (summary, forbiddenMission) => {
    const mission = buildProjectMission({
      projectName: '2375 Compliance Project',
      executiveBrief: {
        executiveSummary: summary,
        rankedPriorities: [],
        recommendations: [],
        escalations: [],
        questionsForUser: [],
        preparations: [],
        projectsNeedingAttention: [],
        userApprovalRequiredItems: [],
      } as never,
      now: NOW,
    });

    expect(mission.missionType).not.toBe(forbiddenMission);
  });

  it('does not satisfy unrelated criteria from one generic evidence event', () => {
    const mission = buildMission({
      missionType: 'project-walk',
      projectName: '2375 Compliance Project',
      projectEvents: [{
        id: 'event-1',
        eventType: 'project_created',
        title: 'Project created',
        description: 'The project record exists.',
        confidence: 'high',
        occurredAt: NOW.toISOString(),
      }] as never,
      now: NOW,
    });

    expect(mission.successCriteria.find(
      item => item.description === 'Open field questions are answered.',
    )?.met).toBe(false);
  });
});
