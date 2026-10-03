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
import { projectAreasForProject } from '../../services/DAVEProjectAreaScope';
import type { ProjectArea, ProjectUpdate, ScheduleItem } from '../../types';

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
    // Q31 review L2 (1 Oct 2026), changed deliberately: no longer the home
    // screen's recent fix (kept up to a minute), which named the area David
    // had walked out of; a new fix from getCurrentLocationSnapshot, the
    // function a new update's captureDraftLocation awaits.
    expect(app).toContain('getLocationFix={getCurrentLocationSnapshot}');
    expect(app).not.toContain('getLocationFix={overviewLocationFixRef');
    const newUpdate = app.slice(app.indexOf('async function captureDraftLocation('), app.indexOf('function recaptureDroppedDraftLocation('));
    expect(newUpdate).toContain('const snapshot = await getCurrentLocationSnapshot();');
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
    // Q31 review L1 (1 Oct 2026), changed deliberately: a later change to
    // another project used to keep it, saving "Lot 5 | Electrical Room".
    it('keeps a location the fill names in the same project; a later change to another project drops it', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix);
      await fix.land(IN_SOUTH_HALLWAY);
      fill(screen, 'Task Replace panel cover, area Electrical Room');
      expect(location(screen)).toBe('Electrical Room');
      expect(screen.queryByText(CAPTION)).toBeNull();
      chooseProject(screen, 'Lot 5');
      expect(location(screen)).toBe('North Yard');
      expect(screen.getByText(CAPTION)).toBeTruthy();
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

  // Q31 review (1 Oct 2026): five lows in the Q31 change.
  describe('Q31 review L1: a project change drops only an area of the old project', () => {
    // "Loading Dock" is an area of Tower B and of Lot 5 alike, far from the fixes here.
    const SHARED_AREAS: ProjectArea[] = [
      ...AREAS,
      area('Loading Dock', 'Tower B', 34.006),
      { ...area('Loading Dock', 'Lot 5', 34.008), id: 'area-Loading Dock-Lot 5' },
    ];
    const pickLocation = (screen: ReturnType<typeof render>, name: string) => {
      fireEvent.press(screen.getByRole('button', { name: 'Choose Location' }));
      fireEvent.press(screen.getByRole('radio', { name }));
    };

    it('the Project field: a picked area of the old project gives way to the GPS suggestion there, and saves so', async () => {
      const fix = gps();
      const { screen, props } = open(fix.getLocationFix);
      await fix.land(IN_SOUTH_HALLWAY);
      pickLocation(screen, 'Electrical Room');
      chooseProject(screen, 'Lot 5');
      expect(location(screen)).toBe('North Yard');
      expect(screen.getByText(CAPTION)).toBeTruthy();
      fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Repaint gate');
      fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
      expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        projectName: 'Lot 5', locationName: 'North Yard',
      }));
    });

    it('the Project field: blank where GPS names nothing, and Lot 5 offers no "Electrical Room"', () => {
      const { screen } = open(undefined);
      pickLocation(screen, 'Electrical Room');
      chooseProject(screen, 'Lot 5');
      expect(location(screen)).toBe('');
      expect(screen.queryByText(CAPTION)).toBeNull();
      fireEvent.press(screen.getByRole('button', { name: 'Choose Location' }));
      expect(screen.queryByRole('radio', { name: 'Electrical Room' })).toBeNull();
    });

    it('the Project field: typed text that is no area of the old project, and an area of both projects, are kept', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix, { projectAreas: SHARED_AREAS });
      await fix.land(IN_SOUTH_HALLWAY);
      fireEvent.changeText(screen.getByLabelText('Location'), 'North gate');
      chooseProject(screen, 'Lot 5');
      expect(location(screen)).toBe('North gate');
      chooseProject(screen, 'Tower B');
      pickLocation(screen, 'Loading Dock');
      chooseProject(screen, 'Lot 5');
      expect(location(screen)).toBe('Loading Dock');
      expect(screen.queryByText(CAPTION)).toBeNull();
    });

    it('a fill changing the project: a picked area of the old project is dropped; typed text and an area of both are kept', async () => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix, { projectAreas: SHARED_AREAS });
      await fix.land(IN_SOUTH_HALLWAY);
      pickLocation(screen, 'Electrical Room');
      fill(screen, 'Task Repaint gate, project Lot 5');
      expect(screen.getByLabelText('Project').props.value).toBe('Lot 5');
      expect(location(screen)).toBe('North Yard');
      expect(screen.getByText(CAPTION)).toBeTruthy();

      const typed = open(fix.getLocationFix, { projectAreas: SHARED_AREAS }).screen;
      fireEvent.changeText(typed.getByLabelText('Location'), 'North gate');
      fill(typed, 'Task Repaint gate, project Lot 5');
      expect(typed.getByLabelText('Project').props.value).toBe('Lot 5');
      expect(location(typed)).toBe('North gate');

      const both = open(fix.getLocationFix, { projectAreas: SHARED_AREAS }).screen;
      pickLocation(both, 'Loading Dock');
      fill(both, 'Task Repaint gate, project Lot 5');
      expect(both.getByLabelText('Project').props.value).toBe('Lot 5');
      expect(location(both)).toBe('Loading Dock');
      expect(both.queryByText(CAPTION)).toBeNull();
    });
  });

  describe('Q31 review L2: each opening takes a new fix', () => {
    it('reopened within the minute, it shows nothing from the earlier fix and fills from the new one', async () => {
      const fix = gps();
      const { screen, props } = open(fix.getLocationFix);
      await fix.land({ latitude: 34.0, longitude: -118, accuracy: 5 });
      expect(location(screen)).toBe('Electrical Room');

      // Closed; he walks 218 ft into the South Hallway and opens it again.
      screen.rerender(<ScheduleTaskEditorModal {...props} visible={false} />);
      screen.rerender(<ScheduleTaskEditorModal {...props} visible />);
      expect(fix.getLocationFix).toHaveBeenCalledTimes(2);
      expect(location(screen)).toBe('');
      expect(screen.queryByText(CAPTION)).toBeNull();

      await fix.land(IN_SOUTH_HALLWAY, 1);
      expect(location(screen)).toBe('South Hallway');
      expect(screen.getByText(CAPTION)).toBeTruthy();
    });
  });

  describe("Q31 review L3: the areas are a new update's for the project", () => {
    // A legacy area: no project name, so its project is inferred from links.
    const LEGACY: ProjectArea = { ...area('Loading Dock', '', 34.006), projectName: null } as ProjectArea;
    const AT_DOCK: AddTaskGpsFix = { latitude: 34.006, longitude: -118, accuracy: 5 };
    const task = (projectName: string) => ({
      id: `task-${projectName}`, projectName, locationName: 'Loading Dock', taskName: 'Unload',
      owner: '', contractor: '', milestone: '', status: 'Not Started', percentComplete: 0,
    }) as unknown as ScheduleItem;
    const savedUpdate = (projectName: string) => ({
      id: `update-${projectName}`, projectName, selectedAreaId: LEGACY.id, selectedAreaName: 'Loading Dock', photos: [],
    }) as unknown as ProjectUpdate;
    // The scope a new update uses: every saved task and the active saved updates.
    const newUpdateNames = (scheduleItems: ScheduleItem[], updates: ProjectUpdate[]) =>
      addTaskAreaSuggestion(AT_DOCK, projectAreasForProject({ projectAreas: [...AREAS, LEGACY], projectName: 'Tower B', scheduleItems, updates }))?.area.name ?? '';

    it.each([
      ['linked to Tower B only by a saved update', [], [], [savedUpdate('Tower B')], 'Loading Dock'],
      ['linked to Tower B by a task and to Lot 5 by an update', [task('Tower B')], [task('Tower B')], [savedUpdate('Lot 5')], ''],
      ['linked to Tower B by a saved task not on the schedule shown', [], [task('Tower B')], [], 'Loading Dock'],
    ])('names what a new update names: an area %s', async (_label, scheduleItems, knownScheduleItems, savedUpdates, named) => {
      expect(newUpdateNames(knownScheduleItems as ScheduleItem[], savedUpdates as ProjectUpdate[])).toBe(named);
      const fix = gps();
      const { screen } = open(fix.getLocationFix, { projectAreas: [...AREAS, LEGACY], scheduleItems, knownScheduleItems, savedUpdates });
      await fix.land(AT_DOCK);
      expect(location(screen)).toBe(named);
      if (named) expect(screen.getByText(CAPTION)).toBeTruthy();
      else expect(screen.queryByText(CAPTION)).toBeNull();
    });

    it("App.tsx passes Add Task the tasks and updates a new update's areas use", () => {
      const app = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
      // New Update: projectAreasForProject over every saved task and the active saved updates.
      const newUpdate = app.slice(app.indexOf('async function captureDraftLocation('), app.indexOf('function recaptureDroppedDraftLocation('));
      expect(newUpdate).toMatch(/projectAreasForProject\(\{\n\s+projectAreas,\n\s+projectName: targetDraft\.projectName,\n\s+scheduleItems,\n\s+updates: activeSavedUpdates,\n\s+\}\)/);
      // The Schedule screen gets those as knownScheduleItems and savedUpdates, and hands them to Add Task.
      const schedule = app.slice(app.indexOf("{screen === 'Schedule' && projectStatusReady && ("), app.indexOf("{screen === 'FieldNotes'"));
      expect(schedule).toContain('knownScheduleItems={scheduleItems}');
      expect(schedule).toContain('savedUpdates={activeSavedUpdates}');
      const addTask = app.slice(app.indexOf('const taskEditor = ('), app.indexOf('const planningTaskEditor = ('));
      expect(addTask).toContain('knownScheduleItems={knownScheduleItems} savedUpdates={savedUpdates}');
    });
  });

  describe('Q31 review L4: no fix is asked for when no area could be suggested', () => {
    const noPoint = (item: ProjectArea): ProjectArea => ({ ...item, locationCapturedAt: null });

    it.each([
      ['no areas at all', []],
      ['areas with no saved GPS point', AREAS.map(noPoint)],
    ])('asks for no fix with %s, whichever project is chosen', (_label, projectAreas) => {
      const fix = gps();
      const { screen } = open(fix.getLocationFix, { projectAreas });
      chooseProject(screen, 'Lot 5');
      chooseProject(screen, 'Main St');
      expect(fix.getLocationFix).not.toHaveBeenCalled();
      expect(location(screen)).toBe('');
      expect(screen.queryByText(CAPTION)).toBeNull();
    });

    it('asks once a chosen project has an area with a saved point, and fills from it', async () => {
      const fix = gps();
      // Tower B's areas have no saved point; Lot 5's do.
      const projectAreas = AREAS.map(item => (item.projectName === 'Tower B' ? noPoint(item) : item));
      const { screen } = open(fix.getLocationFix, { projectAreas });
      expect(fix.getLocationFix).not.toHaveBeenCalled();
      chooseProject(screen, 'Lot 5');
      expect(fix.getLocationFix).toHaveBeenCalledTimes(1);
      await fix.land(IN_SOUTH_HALLWAY);
      expect(location(screen)).toBe('North Yard');
      chooseProject(screen, 'Main St');
      chooseProject(screen, 'Lot 5');
      expect(fix.getLocationFix).toHaveBeenCalledTimes(1);
    });
  });

  describe('Q31 review L5: the guided area question and the form agree', () => {
    function guidedToArea() {
      const fix = gps();
      const { screen } = open(fix.getLocationFix, { initiallyGuided: true });
      const answer = (label: string, value?: string) => {
        if (value !== undefined) fireEvent.changeText(screen.getByLabelText(`Answer ${label}`), value);
        fireEvent.press(screen.getByRole('button', { name: `Save ${label} answer and continue` }));
      };
      answer('Task', 'Patch drywall');
      answer('Item type');
      answer('Project');
      expect(screen.getByLabelText('Answer Area / location').props.value).toBe('');
      return { fix, screen };
    }

    it('a fix landing on the area question shows the suggestion in the answer, as in the form', async () => {
      const { fix, screen } = guidedToArea();
      await fix.land(IN_SOUTH_HALLWAY);
      expect(screen.getByLabelText('Answer Area / location').props.value).toBe('South Hallway');
      expect(location(screen)).toBe('South Hallway');
      expect(screen.getByText(CAPTION)).toBeTruthy();
      fireEvent.press(screen.getByRole('button', { name: 'Save Area / location answer and continue' }));
      expect(screen.getByText('Question 5 of 14')).toBeTruthy();
      expect(location(screen)).toBe('South Hallway');
    });

    it('an answer he typed before the fix landed is his, and is what the form takes', async () => {
      const { fix, screen } = guidedToArea();
      fireEvent.changeText(screen.getByLabelText('Answer Area / location'), 'Stair 2');
      await fix.land(IN_SOUTH_HALLWAY);
      expect(screen.getByLabelText('Answer Area / location').props.value).toBe('Stair 2');
      fireEvent.press(screen.getByRole('button', { name: 'Save Area / location answer and continue' }));
      expect(location(screen)).toBe('Stair 2');
      expect(screen.queryByText(CAPTION)).toBeNull();
    });
  });
});
