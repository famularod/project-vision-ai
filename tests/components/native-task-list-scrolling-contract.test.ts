import fs from 'fs';
import path from 'path';

describe('native task list scrolling contract', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../App.tsx'),
    'utf8',
  );
  const scheduleScreenStart = appSource.indexOf('function ScheduleScreen');
  const scheduleScreen = appSource.slice(
    scheduleScreenStart,
    appSource.indexOf('function ScheduleItemRow', scheduleScreenStart),
  );

  it('keeps enough iOS content rendered for variable-height task rows', () => {
    expect(scheduleScreen).toContain(
      "maxToRenderPerBatch={Platform.OS === 'ios' ? 16 : 12}",
    );
    expect(scheduleScreen).toContain(
      "windowSize={Platform.OS === 'ios' ? 21 : 7}",
    );
    expect(scheduleScreen).toContain(
      "removeClippedSubviews={Platform.OS === 'android'}",
    );
  });

  it('does not use changing sticky headers for the expandable iPhone sections', () => {
    expect(scheduleScreen).toContain('stickySectionHeadersEnabled={false}');
    expect(scheduleScreen).not.toContain(
      'stickySectionHeadersEnabled={!selectedAreaKey}',
    );
  });
});
