import { fireEvent, render } from '@testing-library/react-native';

import { AppShellLayoutProvider, appShellLayoutForWidth } from '../../components/app-shell-layout';
import { MobileSchedulePlanning } from '../../components/mobile-schedule-planning';
import type { ScheduleItem } from '../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('MobileSchedulePlanning', () => {
  test('renders a readable native timeline from the shared schedule', () => {
    const onOpenTask = jest.fn();
    const screen = render(
      <AppShellLayoutProvider layout={appShellLayoutForWidth(390)}>
        <MobileSchedulePlanning
          items={scheduleItems}
          view="Timeline"
          onOpenTask={onOpenTask}
        />
      </AppShellLayoutProvider>,
    );

    expect(screen.getByText('Timeline')).toBeTruthy();
    expect(screen.getByText('Place asphalt')).toBeTruthy();
    expect(screen.getByText('2321 Compliance Project · North Lot')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open timeline task Place asphalt, 50% complete'));
    expect(onOpenTask).toHaveBeenCalledWith(scheduleItems[0]);
  });

  test('switches the construction lookahead between three and six weeks', () => {
    const onOpenTask = jest.fn();
    const screen = render(
      <AppShellLayoutProvider layout={appShellLayoutForWidth(1024)}>
        <MobileSchedulePlanning
          items={scheduleItems}
          view="Lookahead"
          onOpenTask={onOpenTask}
        />
      </AppShellLayoutProvider>,
    );

    expect(screen.getByText('Construction Lookahead')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open lookahead task Place asphalt, In Progress'));
    expect(onOpenTask).toHaveBeenCalledWith(scheduleItems[0]);
    expect(screen.getByLabelText('3 week lookahead')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('6 week lookahead'));
    expect(screen.getByLabelText('6 week lookahead').props.accessibilityState).toEqual({
      selected: true,
    });
  });
});

const scheduleItems: ScheduleItem[] = [
  {
    id: 'asphalt',
    itemType: 'Task',
    scheduleProjectName: '2321 Compliance Project',
    projectName: '2321 Compliance Project',
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: 'Place asphalt',
    startDate: '2026-07-24',
    finishDate: '2026-07-31',
    milestone: '',
    owner: 'Project manager',
    contractor: 'Paving contractor',
    durationDays: 6,
    percentComplete: 50,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-24T12:00:00.000Z',
    progressConfirmedBy: 'PM',
    priority: 'High',
    status: 'In Progress',
    notes: '',
    nextAction: '',
    activity: [],
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
  },
];
