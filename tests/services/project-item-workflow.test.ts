import {
  appendProjectItemActivity,
  normalizeProjectItemActivity,
  normalizeProjectItemType,
} from '../../services/ProjectItemWorkflow';

describe('Project item workflow', () => {
  it('defaults legacy and invalid rows to Task without inventing other classifications', () => {
    expect(normalizeProjectItemType(undefined)).toBe('Task');
    expect(normalizeProjectItemType('Change Order')).toBe('Task');
    expect(normalizeProjectItemType('RFI')).toBe('RFI');
  });

  it('drops malformed activity while preserving valid author and chronology', () => {
    expect(normalizeProjectItemActivity([
      null,
      { message: '   ' },
      {
        id: 'activity-1',
        message: '  Delivery confirmed. ',
        author: ' PM ',
        createdAt: '2026-07-22T18:00:00.000Z',
      },
    ])).toEqual([{
      id: 'activity-1',
      message: 'Delivery confirmed.',
      author: 'PM',
      createdAt: '2026-07-22T18:00:00.000Z',
    }]);
  });

  it('appends meaningful activity and ignores blank entries', () => {
    const existing = [{
      id: 'activity-1',
      message: 'Initial call made.',
      author: 'PM',
      createdAt: '2026-07-22T18:00:00.000Z',
    }];
    expect(appendProjectItemActivity({
      activity: existing,
      message: ' ',
      author: 'PM',
      createdAt: '2026-07-22T19:00:00.000Z',
      id: 'activity-2',
    })).toEqual(existing);
    expect(appendProjectItemActivity({
      activity: existing,
      message: ' Contractor confirmed delivery. ',
      author: ' PM ',
      createdAt: '2026-07-22T19:00:00.000Z',
      id: 'activity-2',
    })).toEqual([
      existing[0],
      {
        id: 'activity-2',
        message: 'Contractor confirmed delivery.',
        author: 'PM',
        createdAt: '2026-07-22T19:00:00.000Z',
      },
    ]);
  });
});
