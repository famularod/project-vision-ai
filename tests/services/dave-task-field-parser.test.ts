import {
  appendDAVETaskFillInstruction,
  buildDAVETaskFillPatch,
  confirmDAVETaskFillField,
  parseDAVETaskFillTranscript,
  resolveDAVETaskFillCandidate,
  type DAVETaskFillTaskCandidate,
} from '../../services/DAVETaskFieldParser';

const existingTask: DAVETaskFillTaskCandidate = {
  id: 'task-1',
  taskName: 'Install east lobby doors',
  projectName: 'Project A',
  locationName: 'East Lobby',
  status: 'Complete',
  percentComplete: 100,
};

describe('DAVE task field parser', () => {
  it('turns a labeled keyboard instruction into proposed task fields', () => {
    const result = parseDAVETaskFillTranscript([
      'Task: Install east lobby doors;',
      'item type: Task;',
      'project: Project A;',
      'area: East Lobby;',
      'owner: David;',
      'contractor: ABC Glass;',
      'start date: today;',
      'due date: tomorrow;',
      'percent: 50%;',
      'priority: High;',
      'next action: Confirm delivery;',
      'notes: Door frames are on site.',
    ].join(' '), {
      projectNames: ['Project A'],
      locationNames: ['East Lobby'],
      ownerNames: ['David'],
      contractorNames: ['ABC Glass'],
      now: new Date('2026-08-01T12:00:00-07:00'),
      currentValues: { projectName: 'Project A' },
    });

    expect(buildDAVETaskFillPatch(result)).toEqual(expect.objectContaining({
      taskName: 'Install east lobby doors',
      itemType: 'Task',
      projectName: 'Project A',
      locationName: 'East Lobby',
      owner: 'David',
      contractor: 'ABC Glass',
      startDate: '2026-08-01',
      finishDate: '2026-08-02',
      percentComplete: 50,
      status: 'In Progress',
      priority: 'High',
      nextAction: 'Confirm delivery',
      notes: 'Door frames are on site',
    }));
  });

  it('requires a candidate choice instead of guessing an ambiguous area', () => {
    const result = parseDAVETaskFillTranscript(
      'Task: Inspect storefront; area: East;',
      {
        projectNames: ['Project A'],
        locationNames: ['East Lobby', 'East Loading Dock'],
        currentValues: { projectName: 'Project A' },
      },
    );

    expect(result.fields.locationName.value).toBeNull();
    expect(result.fields.locationName.candidates).toEqual([
      'East Lobby',
      'East Loading Dock',
    ]);
    expect(result.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'locationName',
        kind: 'ambiguous',
        blocking: true,
      }),
    ]));

    const resolved = resolveDAVETaskFillCandidate(result, 'locationName', 'East Lobby');
    expect(buildDAVETaskFillPatch(resolved)).toEqual(expect.objectContaining({
      locationName: 'East Lobby',
    }));
  });

  it('keeps low-confidence typed candidates proposed until confirmed', () => {
    const result = parseDAVETaskFillTranscript(
      'Task: Inspect storefront; owner: New field lead;',
      { projectNames: ['Project A'], currentValues: { projectName: 'Project A' } },
    );

    expect(result.fields.owner.value).toBe('New field lead');
    expect(buildDAVETaskFillPatch(result).owner).toBeUndefined();
    expect(buildDAVETaskFillPatch(confirmDAVETaskFillField(result, 'owner')).owner)
      .toBe('New field lead');
  });

  it('resolves clear relative dates and leaves unclear dates unapplied', () => {
    const clear = parseDAVETaskFillTranscript(
      'Task: Inspect storefront; start date: tomorrow; due date: in 7 days;',
      {
        now: new Date('2026-08-01T12:00:00-07:00'),
        projectNames: ['Project A'],
        currentValues: { projectName: 'Project A' },
      },
    );
    expect(buildDAVETaskFillPatch(clear)).toEqual(expect.objectContaining({
      startDate: '2026-08-02',
      finishDate: '2026-08-08',
    }));

    const unclear = parseDAVETaskFillTranscript(
      'Task: Inspect storefront; due date: next Friday sometime;',
      { projectNames: ['Project A'], currentValues: { projectName: 'Project A' } },
    );
    expect(unclear.fields.finishDate.value).toBeNull();
    expect(unclear.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'finishDate', kind: 'unclear_date' }),
    ]));
    expect(buildDAVETaskFillPatch(unclear).finishDate).toBeUndefined();
  });

  it.each([
    [0, 'Not Started'],
    [50, 'In Progress'],
    [100, 'Complete'],
  ] as const)('enforces the %i percent rule', (percentComplete, status) => {
    const result = parseDAVETaskFillTranscript(`percent: ${percentComplete}%`, {
      mode: 'update',
      currentValues: { status: 'Complete', percentComplete: 100 },
    });
    expect(buildDAVETaskFillPatch(result, {
      status: 'Complete',
      percentComplete: 100,
    })).toEqual({ percentComplete, status });
  });

  it('keeps an explicit Waiting status when a percentage is supplied', () => {
    const result = parseDAVETaskFillTranscript('status: Waiting; percent: 50%', {
      mode: 'update',
      currentValues: { status: 'Complete', percentComplete: 100 },
    });
    expect(buildDAVETaskFillPatch(result, {
      status: 'Complete',
      percentComplete: 100,
    })).toEqual({ status: 'Waiting', percentComplete: 50 });
  });

  it('reopens a completed task from either a lower percentage or non-complete status', () => {
    const byPercent = parseDAVETaskFillTranscript('percent: 50%', { mode: 'update' });
    expect(buildDAVETaskFillPatch(byPercent, {
      status: 'Complete',
      percentComplete: 100,
    })).toEqual({ status: 'In Progress', percentComplete: 50 });

    const byStatus = parseDAVETaskFillTranscript('status: In Progress', { mode: 'update' });
    expect(buildDAVETaskFillPatch(byStatus, {
      status: 'Complete',
      percentComplete: 100,
    })).toEqual({ status: 'In Progress', percentComplete: 99 });
  });

  it('preserves every unspecified value by returning only requested field changes', () => {
    const result = parseDAVETaskFillTranscript('owner: David', {
      mode: 'update',
      ownerNames: ['David'],
      currentValues: {
        taskName: 'Existing task',
        projectName: 'Project A',
        locationName: 'East Lobby',
        status: 'Waiting',
        percentComplete: 25,
      },
    });
    expect(buildDAVETaskFillPatch(result, {
      status: 'Waiting',
      percentComplete: 25,
    })).toEqual({ owner: 'David' });
  });

  it('does not infer status, priority, or ownership from words inside a task name or note', () => {
    const result = parseDAVETaskFillTranscript(
      'Task: Complete high bay lighting review; notes: David saw the fixture sample;',
      {
        mode: 'update',
        ownerNames: ['David'],
        currentValues: {
          taskName: 'Existing task',
          projectName: 'Project A',
          locationName: 'East Lobby',
          status: 'Not Started',
          percentComplete: 0,
        },
      },
    );

    expect(result.fields.status.value).toBeNull();
    expect(result.fields.priority.value).toBeNull();
    expect(result.fields.owner.value).toBeNull();
    expect(buildDAVETaskFillPatch(result)).toEqual(expect.objectContaining({
      taskName: 'Complete high bay lighting review',
      notes: 'David saw the fixture sample',
    }));
  });

  it('supports a supplied project item type as part of a new-item instruction', () => {
    const result = parseDAVETaskFillTranscript(
      'Create an issue Missing storefront glass; project: Project A;',
      {
        projectNames: ['Project A'],
        currentValues: { projectName: 'Project A', locationName: 'East Lobby' },
      },
    );

    expect(buildDAVETaskFillPatch(result)).toEqual(expect.objectContaining({
      taskName: 'Missing storefront glass',
      itemType: 'Issue',
    }));
  });

  it('keeps an explicitly supplied milestone with the other reviewed task fields', () => {
    const result = parseDAVETaskFillTranscript(
      'Task: Install storefront glass; milestone: Building dry-in; project: Project A;',
      {
        projectNames: ['Project A'],
        currentValues: { projectName: 'Project A', locationName: 'East Lobby' },
      },
    );

    expect(buildDAVETaskFillPatch(result)).toEqual(expect.objectContaining({
      taskName: 'Install storefront glass',
      milestone: 'Building dry-in',
    }));
  });

  it('surfaces duplicate task candidates before a new task can be applied', () => {
    const result = parseDAVETaskFillTranscript(
      'Task: Install east lobby doors; project: Project A; area: East Lobby;',
      {
        taskCandidates: [
          existingTask,
          { ...existingTask, id: 'task-2', projectName: 'Project B' },
        ],
        projectNames: ['Project A', 'Project B'],
        locationNames: ['East Lobby'],
        currentValues: { projectName: 'Project A', locationName: 'East Lobby' },
      },
    );

    expect(result.taskMatches).toHaveLength(2);
    expect(result.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'taskMatch',
        kind: 'duplicate_task',
        blocking: true,
      }),
    ]));
  });

  it('combines typed and recorded instructions without discarding either source', () => {
    const mixed = appendDAVETaskFillInstruction(
      'Task: Inspect storefront; owner: David;',
      'area: East Lobby; percent: 50%;',
    );
    const result = parseDAVETaskFillTranscript(mixed, {
      projectNames: ['Project A'],
      locationNames: ['East Lobby'],
      ownerNames: ['David'],
      currentValues: { projectName: 'Project A' },
    });

    expect(result.transcript).toContain('owner: David');
    expect(result.transcript).toContain('area: East Lobby');
    expect(buildDAVETaskFillPatch(result)).toEqual(expect.objectContaining({
      taskName: 'Inspect storefront',
      owner: 'David',
      locationName: 'East Lobby',
      status: 'In Progress',
      percentComplete: 50,
    }));
  });
});
