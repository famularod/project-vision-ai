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
      '`Completed · Finish date ${formatAppDate(displayedItem.finishDate)}`',
    );
    expect(scheduleItemRow).toContain(
      'dueStatusText(displayedItem.finishDate, displayedItem.projectTimeZone || DEFAULT_PROJECT_TIME_ZONE)',
    );
    expect(scheduleItemRow).toContain(
      "{timingStatus}{item.contractor ? ` • ${item.contractor}` : ''}",
    );
  });

  it('keeps progress changes staged until the explicit save action', () => {
    expect(scheduleItemRow).toContain(
      'onCommit={percentComplete => stageProgressEdit({ percentComplete })}',
    );
    expect(scheduleItemRow).toContain(
      'onPress={() => stageProgressEdit({ status })}',
    );
    expect(scheduleItemRow).toContain('if (progressDraftDirty) {');
    expect(scheduleItemRow).toContain('onUpdate(progressDraft);');
    expect(scheduleItemRow).toContain('const synced = await onSave();');
  });

  it('keeps photo and note capture available after a task is completed', () => {
    expect(scheduleItemRow).toContain(
      'committedItemComplete && onAddFieldUpdate && !expanded',
    );
    expect(scheduleItemRow).toContain('label="Add Photo or Note"');
  });
});
