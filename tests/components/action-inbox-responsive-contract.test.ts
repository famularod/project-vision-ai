import fs from 'fs';
import path from 'path';

describe('Action Inbox responsive presentation', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../App.tsx'),
    'utf8',
  );
  const scheduleScreenStart = appSource.indexOf('function ScheduleScreen');
  const scheduleScreen = appSource.slice(
    scheduleScreenStart,
    appSource.indexOf('function ScheduleCommittedTextField', scheduleScreenStart),
  );

  it('uses Needs Attention instead of rendering a duplicate Action Inbox panel', () => {
    expect(scheduleScreen).toContain('const actionInbox = useMemo(');
    expect(scheduleScreen).toContain('const attentionScheduleItemIds = useMemo(');
    expect(scheduleScreen).toContain('attentionScheduleItemIds.has(item.id)');
    expect(scheduleScreen).not.toContain(
      '<Text style={styles.panelTitle}>Action Inbox</Text>',
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
