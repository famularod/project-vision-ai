import fs from 'fs';
import path from 'path';

describe('Action Inbox responsive presentation', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../App.tsx'),
    'utf8',
  );
  const scheduleScreen = appSource.slice(
    appSource.indexOf('function ScheduleScreen'),
    appSource.indexOf('function DAVEActionInboxRow'),
  );

  it('keeps the expanded Action Inbox out of compact and medium task layouts', () => {
    expect(scheduleScreen).toContain(
      '{isWideWorkspace && actionInbox.items.length > 0 ? (',
    );
    expect(scheduleScreen).toContain(
      ') : isWideWorkspace ? (',
    );
  });

  it('routes the compact Needs Attention control to the normal Attention task view', () => {
    expect(scheduleScreen).toContain(
      'needsActionCount={attentionTaskIds.size}',
    );
    expect(scheduleScreen).toContain('onNeedsAttentionPress={() => {');
    expect(scheduleScreen).toContain("setTaskView('Open Tasks');");
    expect(scheduleScreen).toContain("setTaskFilter('Attention');");
  });
});
