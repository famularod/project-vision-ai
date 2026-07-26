import fs from 'fs';
import path from 'path';

describe('schedule task status copy contract', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../App.tsx'),
    'utf8',
  );
  const scheduleItemRow = appSource.slice(
    appSource.indexOf('function ScheduleItemRow'),
    appSource.indexOf('function scheduleWarningIsUserActionable'),
  );

  it('does not describe completed work as due or overdue', () => {
    expect(scheduleItemRow).toContain('const timingStatus = itemComplete');
    expect(scheduleItemRow).toContain(
      '`Completed · Finish date ${formatAppDate(item.finishDate)}`',
    );
    expect(scheduleItemRow).toContain(
      'dueStatusText(item.finishDate, item.projectTimeZone || DEFAULT_PROJECT_TIME_ZONE)',
    );
    expect(scheduleItemRow).toContain(
      "{timingStatus}{item.contractor ? ` • ${item.contractor}` : ''}",
    );
  });
});
