import type { ScheduleItem } from '../../types';
import {
  SCHEDULE_IMPORT_NEEDS_PROJECT,
  validateScheduleImportScope,
} from '../../services/ScheduleImportScopeGuard';

const selectedProjects = [
  {
    id: 'project-2321',
    name: '2321 Compliance Project',
    aliases: ['PLZ 2321'],
  },
  {
    id: 'project-2375',
    name: '2375 Compliance Project',
  },
] as const;

function scheduleItem(
  overrides: Partial<ScheduleItem> = {},
): ScheduleItem {
  return {
    id: 'schedule-item-1',
    scheduleProjectName: null,
    projectName: '2321 Compliance Project',
    locationName: 'North Lot',
    taskName: 'Place asphalt',
    startDate: '07/20/2026',
    finishDate: '07/24/2026',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-07-18T12:00:00.000Z',
    ...overrides,
  };
}

describe('validateScheduleImportScope', () => {
  it('canonicalizes selected projects by name, ID, and explicit alias', () => {
    const result = validateScheduleImportScope({
      items: [
        scheduleItem({
          id: 'by-name',
          projectName: ' 2321   compliance project ',
        }),
        scheduleItem({
          id: 'by-id',
          projectName: 'PROJECT-2375',
        }),
        scheduleItem({
          id: 'by-alias',
          projectName: 'plz 2321',
        }),
      ],
      selectedProjects,
    });

    expect(result.items.map(item => item.projectName)).toEqual([
      '2321 Compliance Project',
      '2375 Compliance Project',
      '2321 Compliance Project',
    ]);
    expect(result.itemResults.map(item => item.selectedProjectId)).toEqual([
      'project-2321',
      'project-2375',
      'project-2321',
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.needsProjectCount).toBe(0);
  });

  it('maps unknown projects to Needs Project without retaining a create candidate', () => {
    const result = validateScheduleImportScope({
      items: [
        scheduleItem({
          projectName: 'Old Warehouse Project',
          scheduleProjectName: 'Old Warehouse Master Schedule',
        }),
      ],
      selectedProjects,
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      projectName: SCHEDULE_IMPORT_NEEDS_PROJECT,
      scheduleProjectName: null,
    }));
    expect(result.itemResults[0]).toEqual(expect.objectContaining({
      originalProjectName: 'Old Warehouse Project',
      originalScheduleProjectName: 'Old Warehouse Master Schedule',
      selectedProjectId: null,
      assignment: 'needs_project',
    }));
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'project_not_selected',
        sourceValue: 'Old Warehouse Project',
      }),
      expect.objectContaining({
        code: 'schedule_parent_not_selected',
        sourceValue: 'Old Warehouse Master Schedule',
      }),
    ]));
  });

  it('never restores deleted or archived projects, even from contradictory selected input', () => {
    const result = validateScheduleImportScope({
      items: [
        scheduleItem({
          id: 'archived',
          projectName: 'Project-2321',
          scheduleProjectName: '2321 Compliance Project',
        }),
        scheduleItem({
          id: 'deleted',
          projectName: 'Legacy Project',
          scheduleProjectName: 'Legacy Project',
        }),
      ],
      selectedProjects,
      unavailableProjects: [
        {
          id: 'project-2321',
          name: '2321 Compliance Project',
          state: 'archived',
        },
        {
          id: 'deleted-project',
          name: 'Legacy Project',
          state: 'deleted',
        },
      ],
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        projectName: SCHEDULE_IMPORT_NEEDS_PROJECT,
        scheduleProjectName: null,
      }),
      expect.objectContaining({
        projectName: SCHEDULE_IMPORT_NEEDS_PROJECT,
        scheduleProjectName: null,
      }),
    ]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'archived', code: 'project_archived' }),
      expect.objectContaining({ itemId: 'archived', code: 'schedule_parent_archived' }),
      expect.objectContaining({ itemId: 'deleted', code: 'project_deleted' }),
      expect.objectContaining({ itemId: 'deleted', code: 'schedule_parent_deleted' }),
    ]));
    expect(result.needsProjectCount).toBe(2);
  });

  it('uses a valid selected schedule parent only when the row has no project', () => {
    const result = validateScheduleImportScope({
      items: [
        scheduleItem({
          projectName: '',
          scheduleProjectName: 'PLZ 2321',
        }),
      ],
      selectedProjects,
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      projectName: '2321 Compliance Project',
      scheduleProjectName: '2321 Compliance Project',
    }));
    expect(result.warnings).toEqual([]);
  });

  it('keeps a valid row project but removes an unknown schedule parent', () => {
    const result = validateScheduleImportScope({
      items: [
        scheduleItem({
          projectName: '2375 Compliance Project',
          scheduleProjectName: 'Imported Portfolio Root',
        }),
      ],
      selectedProjects,
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      projectName: '2375 Compliance Project',
      scheduleProjectName: null,
    }));
    expect(result.itemResults[0].assignment).toBe('selected_project');
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'schedule_parent_not_selected',
        sourceValue: 'Imported Portfolio Root',
      }),
    ]);
  });

  it('leaves ambiguous selected aliases unassigned', () => {
    const result = validateScheduleImportScope({
      items: [scheduleItem({ projectName: 'Shared Alias' })],
      selectedProjects: [
        { id: 'one', name: 'One', aliases: ['Shared Alias'] },
        { id: 'two', name: 'Two', aliases: ['Shared Alias'] },
      ],
    });

    expect(result.items[0].projectName).toBe(SCHEDULE_IMPORT_NEEDS_PROJECT);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'project_ambiguous' }),
    ]);
  });

  it('canonicalizes only areas owned by the resolved selected project', () => {
    const result = validateScheduleImportScope({
      items: [
        scheduleItem({
          id: 'valid-area',
          projectName: '2321 Compliance Project',
          locationName: 'north-lot-id',
        }),
        scheduleItem({
          id: 'cross-project-area',
          projectName: '2321 Compliance Project',
          locationName: 'Canopy C',
        }),
      ],
      selectedProjects,
      selectedProjectAreas: [
        {
          projectId: 'project-2321',
          areas: [{ id: 'north-lot-id', name: 'North Lot' }],
        },
        {
          projectId: 'project-2375',
          areas: [{ id: 'canopy-c-id', name: 'Canopy C' }],
        },
      ],
    });

    expect(result.items[0].locationName).toBe('North Lot');
    expect(result.items[1].locationName).toBe('');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: 'cross-project-area',
        code: 'area_not_in_selected_project',
        field: 'area',
      }),
    ]));
  });

  it('reports invalid dates and start-after-finish without rewriting source dates', () => {
    const result = validateScheduleImportScope({
      items: [
        scheduleItem({
          id: 'invalid-dates',
          startDate: '02/30/2026',
          finishDate: 'not-a-date',
        }),
        scheduleItem({
          id: 'reversed-dates',
          startDate: '07/25/2026',
          finishDate: '07/24/2026',
        }),
      ],
      selectedProjects,
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      startDate: '02/30/2026',
      finishDate: 'not-a-date',
    }));
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: 'invalid-dates',
        code: 'invalid_start_date',
      }),
      expect.objectContaining({
        itemId: 'invalid-dates',
        code: 'invalid_finish_date',
      }),
      expect.objectContaining({
        itemId: 'reversed-dates',
        code: 'start_after_finish',
      }),
    ]));
  });

  it('accepts the normalized display dates produced by the existing CSV importer', () => {
    const result = validateScheduleImportScope({
      items: [
        scheduleItem({
          startDate: 'Jul 20, 2026',
          finishDate: 'Jul 24, 2026',
        }),
      ],
      selectedProjects,
    });

    expect(result.warnings).toEqual([]);
  });

  it('does not mutate extracted schedule items', () => {
    const original = scheduleItem({
      projectName: 'Unknown Project',
      scheduleProjectName: 'Unknown Parent',
    });
    const originalSnapshot = JSON.parse(JSON.stringify(original));

    const result = validateScheduleImportScope({
      items: [original],
      selectedProjects,
    });

    expect(original).toEqual(originalSnapshot);
    expect(result.items[0]).not.toBe(original);
  });
});
