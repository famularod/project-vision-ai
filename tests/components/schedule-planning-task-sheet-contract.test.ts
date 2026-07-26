import fs from 'fs';
import path from 'path';

describe('Schedule planning task sheet safe area', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../App.tsx'),
    'utf8',
  );
  const scheduleScreen = appSource.slice(
    appSource.indexOf('function ScheduleScreen'),
    appSource.indexOf('function DAVEActionInboxRow'),
  );

  it('keeps the task sheet header and close control below the device status area', () => {
    expect(scheduleScreen).toContain(
      'const scheduleScreenInsets = useSafeAreaInsets();',
    );
    expect(scheduleScreen).toContain(
      'paddingTop: scheduleScreenInsets.top,',
    );
    expect(scheduleScreen).toContain(
      'paddingBottom: scheduleScreenInsets.bottom,',
    );
    expect(scheduleScreen).toContain(
      'accessibilityLabel="Close schedule task"',
    );
  });
});
