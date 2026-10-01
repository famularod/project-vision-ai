/**
 * Owner answer Q31 (1 Oct 2026), "go with a".
 *
 * David stood in one area of a project, opened Add Task, and Location came
 * up as the project's first area: Add Task never used GPS and always filled
 * the first area, which read like a suggestion. Now Location starts blank
 * and fills with the area GPS places him in, by the rule a new update's
 * suggestion uses plus the clear-winner margin, with a caption saying so;
 * otherwise it stays blank. His own entry always wins.
 */
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { ScheduleTaskEditorModal } from '../../components/schedule-task-editor-modal';
import { addTaskAreaSuggestion, type AddTaskGpsFix } from '../../services/AreaSuggestion';
import type { ProjectArea } from '../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../components/DAVEVoiceCaptureSheet', () => ({ DAVEVoiceCaptureSheet: () => null }));
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props: Record<string, unknown>) => <View {...props} /> };
});

const CAPTURED = '2026-09-29T12:00:00.000Z';
// About 364 ft per thousandth of a degree of latitude here.
const area = (name: string, projectName: string, latitude: number, radiusFeet = 150): ProjectArea => ({
  id: `area-${name}`,
  name,
  projectName,
  latitude,
  longitude: -118,
  radiusFeet,
  locationCapturedAt: CAPTURED,
});
const AREAS: ProjectArea[] = [
  // The project's first area: what Add Task used to fill in.
  area('Electrical Room', 'Tower B', 34.0),
  area('South Hallway', 'Tower B', 34.002),
  area('Lot 5 Gate', 'Lot 5', 34.004),
  area('North Yard', 'Lot 5', 34.00205, 200),
  area('Main St Roof', 'Main St', 34.01),
];
const TIED_AREAS: ProjectArea[] = [
  ...AREAS,
  // Seven feet from the South Hallway's centre: GPS cannot tell them apart.
  area('South Stair', 'Tower B', 34.00202),
];
const IN_SOUTH_HALLWAY: AddTaskGpsFix = { latitude: 34.002, longitude: -118, accuracy: 5 };
const CAPTION = 'Suggested from your location';

/** Fixes Add Task asked for, landed by the test inside act. */
function gps() {
  const pending: Array<{ resolve: (fix: AddTaskGpsFix | null) => void; reject: (error: Error) => void }> = [];
  const getLocationFix = jest.fn(() => new Promise<AddTaskGpsFix | null>((resolve, reject) => {
    pending.push({ resolve, reject });
  }));
  return {
    getLocationFix,
    land: (fix: AddTaskGpsFix | null, request = pending.length - 1) =>
      act(async () => pending[request].resolve(fix)),
    fail: () => act(async () => pending[pending.length - 1].reject(new Error('Location unavailable'))),
  };
}

describe('Owner answer Q31: Add Task suggests the area you are standing in', () => {
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => alert.mockRestore());

  function open(getLocationFix: (() => Promise<AddTaskGpsFix | null>) | undefined, extra: Record<string, unknown> = {}) {
    const props = {
      visible: true,
      projects: ['Tower B', 'Lot 5', 'Main St'],
      projectAreas: AREAS,
      scheduleItems: [],
      initialProjectName: 'Tower B',
      defaultOwner: 'David',
      getLocationFix,
      onClose: jest.fn(),
      onSubmit: jest.fn(),
      ...extra,
    };
    const screen = render(<ScheduleTaskEditorModal {...props} />);
    return { screen, props };
  }
  const location = (screen: ReturnType<typeof render>) => screen.getByLabelText('Location').props.value;
  const chooseProject = (screen: ReturnType<typeof render>, name: string) => {
    fireEvent.press(screen.getByRole('button', { name: 'Choose Project' }));
    fireEvent.press(screen.getByRole('radio', { name }));
  };
  function fill(screen: ReturnType<typeof render>, instruction: string) {
    fireEvent.press(screen.getByRole('button', { name: 'Fill task with voice or text' }));
    fireEvent.changeText(screen.getByLabelText('Editable task instruction'), instruction);
    fireEvent.press(screen.getByRole('button', { name: 'Review proposed task changes' }));
    fireEvent.press(screen.getByRole('button', { name: 'Apply proposed changes to task form' }));
  }

  describe('the rule (services/AreaSuggestion addTaskAreaSuggestion)', () => {
    const tower = AREAS.filter(item => item.projectName === 'Tower B');

    it('names the one area the fix is confidently inside, not the first area', () => {
      expect(addTaskAreaSuggestion(IN_SOUTH_HALLWAY, tower)?.area.name).toBe('South Hallway');
    });

    it('names the nearer of two areas the fix is inside only by the clear-winner margin', () => {
      const tied = TIED_AREAS.filter(item => item.projectName === 'Tower B');
      expect(addTaskAreaSuggestion(IN_SOUTH_HALLWAY, tied)).toBeNull();
      // A large area around a small one, centres 182 ft apart: the small one wins.
      const nested = [...tower, area('Tower B Floor 2', 'Tower B', 34.0025, 400)];
      expect(addTaskAreaSuggestion(IN_SOUTH_HALLWAY, nested)?.area.name).toBe('South Hallway');
    });

    it.each([
      ['location not allowed', null],
      ['Precise Location off', { ...IN_SOUTH_HALLWAY, preciseLocationOff: true }],
      ['an imprecise fix (±164 ft)', { ...IN_SOUTH_HALLWAY, accuracy: 50 }],
      ['a fix with no accuracy', { ...IN_SOUTH_HALLWAY, accuracy: null }],
      ['a fix outside every area', { latitude: 34.001, longitude: -118, accuracy: 5 }],
    ])('names none for %s', (_label, fix) => {
      expect(addTaskAreaSuggestion(fix as AddTaskGpsFix | null, tower)).toBeNull();
    });
  });

  it('fills Location with the area GPS places David in, with a caption, and saves it', async () => {
    const fix = gps();
    const { screen, props } = open(fix.getLocationFix);
    expect(location(screen)).toBe('');
    expect(screen.queryByText(CAPTION)).toBeNull();

    await fix.land(IN_SOUTH_HALLWAY);
    expect(location(screen)).toBe('South Hallway');
    expect(screen.getByText(CAPTION)).toBeTruthy();
    expect(fix.getLocationFix).toHaveBeenCalledTimes(1);

    fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Patch drywall');
    fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      taskName: 'Patch drywall', projectName: 'Tower B', locationName: 'South Hallway',
    }));
  });

  it('leaves Location blank, with no caption, when two areas tie', async () => {
    const fix = gps();
    const { screen } = open(fix.getLocationFix, { projectAreas: TIED_AREAS });
    await fix.land(IN_SOUTH_HALLWAY);
    expect(location(screen)).toBe('');
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  it.each([
    ['location not allowed', null],
    ['Precise Location off', { ...IN_SOUTH_HALLWAY, preciseLocationOff: true }],
    ['an imprecise fix', { ...IN_SOUTH_HALLWAY, accuracy: 50 }],
    ['a fix with no accuracy', { ...IN_SOUTH_HALLWAY, accuracy: null }],
  ])('leaves Location blank, with no caption or prompt, for %s', async (_label, landed) => {
    const fix = gps();
    const { screen } = open(fix.getLocationFix);
    await fix.land(landed as AddTaskGpsFix | null);
    expect(location(screen)).toBe('');
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it('leaves Location blank, and says nothing, when the fix fails', async () => {
    const fix = gps();
    const { screen } = open(fix.getLocationFix);
    await fix.fail();
    expect(location(screen)).toBe('');
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it('leaves Location blank with no way to get a fix (the first-area default is gone)', () => {
    const { screen } = open(undefined);
    expect(location(screen)).toBe('');
    chooseProject(screen, 'Lot 5');
    expect(location(screen)).toBe('');
  });

  it('never asks for location itself: it uses the fix the app takes for a new update', () => {
    const root = path.join(__dirname, '..', '..');
    for (const file of ['components/schedule-task-editor-modal.tsx', 'hooks/use-add-task-location.ts']) {
      expect(fs.readFileSync(path.join(root, file), 'utf8')).not.toContain('expo-location');
    }
    const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
    // The home screen's recent fix while fresh (overviewFixMaxAgeMs), else a
    // new one from getCurrentLocationSnapshot, as a new update takes it.
    expect(app).toContain('getLocationFix={overviewLocationFixRef.current.get}');
    expect(app).toContain('createRecentLocationFix(() => getCurrentLocationSnapshot(), 60_000, {');
  });

  describe("David's own entry wins", () => {
    it('keeps a location he typed before the fix arrived', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix);
      fireEvent.changeText(screen.getByLabelText('Location'), 'North gate');
      await fix.land(IN_SOUTH_HALLWAY);
      expect(location(screen)).toBe('North gate');
      expect(screen.queryByText(CAPTION)).toBeNull();
    });

    it('keeps a location he picked before the fix arrived', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix);
      fireEvent.press(screen.getByRole('button', { name: 'Choose Location' }));
      fireEvent.press(screen.getByRole('radio', { name: 'Electrical Room' }));
      await fix.land(IN_SOUTH_HALLWAY);
      expect(location(screen)).toBe('Electrical Room');
      expect(screen.queryByText(CAPTION)).toBeNull();
    });

    it('keeps a location he cleared blank', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix);
      await fix.land(IN_SOUTH_HALLWAY);
      fireEvent.changeText(screen.getByLabelText('Location'), '');
      chooseProject(screen, 'Lot 5');
      expect(location(screen)).toBe('');
      expect(screen.queryByText(CAPTION)).toBeNull();
    });
  });

  describe('a project change', () => {
    it('recomputes from the same fix for the new project, blank when none of its areas contains him', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix);
      await fix.land(IN_SOUTH_HALLWAY);
      chooseProject(screen, 'Lot 5');
      expect(location(screen)).toBe('North Yard');
      expect(screen.getByText(CAPTION)).toBeTruthy();
      chooseProject(screen, 'Main St');
      expect(location(screen)).toBe('');
      expect(screen.queryByText(CAPTION)).toBeNull();
      expect(fix.getLocationFix).toHaveBeenCalledTimes(1);
    });

    it('uses the project chosen before the fix arrived', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix);
      chooseProject(screen, 'Lot 5');
      await fix.land(IN_SOUTH_HALLWAY);
      expect(location(screen)).toBe('North Yard');
    });

    it('keeps a location he typed', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix);
      await fix.land(IN_SOUTH_HALLWAY);
      fireEvent.changeText(screen.getByLabelText('Location'), 'North gate');
      chooseProject(screen, 'Lot 5');
      expect(location(screen)).toBe('North gate');
      expect(screen.queryByText(CAPTION)).toBeNull();
    });
  });

  describe('Fill with voice or text', () => {
    it('keeps a location the fill names in the same project, and a later project change keeps it', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix);
      await fix.land(IN_SOUTH_HALLWAY);
      fill(screen, 'Task Replace panel cover, area Electrical Room');
      expect(location(screen)).toBe('Electrical Room');
      expect(screen.queryByText(CAPTION)).toBeNull();
      chooseProject(screen, 'Lot 5');
      expect(location(screen)).toBe('Electrical Room');
    });

    it("keeps an area the fill names in another project over the GPS suggestion there", async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix);
      await fix.land(IN_SOUTH_HALLWAY);
      fill(screen, 'Task Repaint gate, project Lot 5, area Lot 5 Gate');
      expect(screen.getByLabelText('Project').props.value).toBe('Lot 5');
      expect(location(screen)).toBe('Lot 5 Gate');
      expect(screen.queryByText(CAPTION)).toBeNull();
    });

    it("naming another project but no area, takes the area GPS places him in there, else blank (never the first area)", async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix);
      await fix.land(IN_SOUTH_HALLWAY);
      fill(screen, 'Task Repaint gate, project Lot 5');
      expect(location(screen)).toBe('North Yard');
      expect(screen.getByText(CAPTION)).toBeTruthy();

      const blank = open(undefined, { initialProjectName: 'Tower B' }).screen;
      fill(blank, 'Task Seal roof, project Main St');
      expect(blank.getByLabelText('Project').props.value).toBe('Main St');
      expect(location(blank)).toBe('');
    });

    it('guided: the area question after another project starts on the area GPS places him in there, else blank', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix, { initiallyGuided: true });
      await fix.land(IN_SOUTH_HALLWAY);
      const answer = (label: string, value?: string) => {
        if (value !== undefined) fireEvent.changeText(screen.getByLabelText(`Answer ${label}`), value);
        fireEvent.press(screen.getByRole('button', { name: `Save ${label} answer and continue` }));
      };
      answer('Task', 'Repaint gate');
      answer('Item type');
      answer('Project', 'Lot 5');
      expect(screen.getByLabelText('Answer Area / location').props.value).toBe('North Yard');
      fireEvent.press(screen.getByRole('button', { name: 'Previous task question' }));
      answer('Project', 'Main St');
      expect(screen.getByLabelText('Answer Area / location').props.value).toBe('');
      expect(location(screen)).toBe('');
    });
  });

  it('opens fresh: a new fix each time, and a fix from a closed form fills nothing', async () => {
    const fix = gps();
    const { screen, props } = open(fix.getLocationFix);
    screen.rerender(<ScheduleTaskEditorModal {...props} visible={false} />);
    screen.rerender(<ScheduleTaskEditorModal {...props} visible />);
    expect(fix.getLocationFix).toHaveBeenCalledTimes(2);
    await fix.land(IN_SOUTH_HALLWAY, 0);
    expect(location(screen)).toBe('');
    await fix.land({ latitude: 34.0, longitude: -118, accuracy: 5 }, 1);
    expect(location(screen)).toBe('Electrical Room');
  });

  it('leaves editing an existing task alone: only Add Task gets the fix', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
    // Passed to ScheduleScreen (prop, its type) and on to Add Task's modal (twice on one line), nowhere else.
    expect(app.match(/getLocationFix/g)).toHaveLength(5);
    const addTask = app.slice(app.indexOf('const taskEditor = ('), app.indexOf('const planningTaskEditor = ('));
    expect(addTask).toContain('<ScheduleTaskEditorModal');
    expect(addTask).toContain('getLocationFix={getLocationFix}');
  });

  it('leaves the web alone: its Add Task already starts with a blank Location', () => {
    const root = path.join(__dirname, '..', '..', 'components', 'web-shell');
    const schedule = fs.readFileSync(path.join(root, 'desktop-schedule-page.tsx'), 'utf8');
    const openNew = schedule.slice(schedule.indexOf('const openNew = '), schedule.indexOf('const openEdit = '));
    expect(openNew).toContain("locationName: '',");
    const shell = fs.readFileSync(path.join(root, 'desktop-read-only-shell.tsx'), 'utf8');
    expect(shell).toContain("locationName: task?.locationName ?? '',");
  });
});
