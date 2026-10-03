import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { ScheduleTaskEditorModal } from '../../components/schedule-task-editor-modal';
import {
  guidedAnswerRequestsSkip,
  normalizeDAVETaskGuidedVoiceAnswer,
} from '../../components/dave-task-fill-assistant';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../components/DAVEVoiceCaptureSheet', () => {
  const { Pressable, Text } = require('react-native');
  return {
    DAVEVoiceCaptureSheet: ({
      visible,
      onMemoryReady,
      captureLabel,
    }: {
      visible: boolean;
      onMemoryReady: (result: Record<string, unknown>) => void;
      captureLabel?: string;
    }) => visible ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Complete mock task recording"
        onPress={() => onMemoryReady({
          schemaVersion: 'dave-voice-understanding/1.0',
          transcript: captureLabel === 'Task'
            ? 'Task - Field Test 149'
            : 'Task: Inspect storefront; area: East Lobby; percent: 50%;',
          transcriptionModel: 'mock-transcriber',
          understanding: {
            status: 'unavailable',
            model: null,
            recommendedLocation: { value: null, confidence: 'unknown' },
            fields: {},
          },
        })}
      >
        <Text>Complete mock task recording</Text>
      </Pressable>
    ) : null,
  };
});
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => <View {...props} />,
  };
});

describe('ScheduleTaskEditorModal', () => {
  it('accepts either a spoken field header or an answer by itself', () => {
    expect(normalizeDAVETaskGuidedVoiceAnswer('taskName', 'Task - Field Test 149'))
      .toBe('Field Test 149');
    expect(normalizeDAVETaskGuidedVoiceAnswer('itemType', 'Project item type: Task'))
      .toBe('Task');
    expect(normalizeDAVETaskGuidedVoiceAnswer('taskName', 'Field Test 149'))
      .toBe('Field Test 149');
    expect(normalizeDAVETaskGuidedVoiceAnswer(
      'taskName',
      'The name of this task should be Step 1 of Verification for Build 149.',
    )).toBe('Step 1 of Verification for Build 149');
    expect(normalizeDAVETaskGuidedVoiceAnswer('taskName', 'The Name of the Rose'))
      .toBe('The Name of the Rose');
    expect(guidedAnswerRequestsSkip('Leave it blank.')).toBe(true);
  });

  it('uses native calendar controls for both task dates', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A']}
        projectAreas={[]}
        scheduleItems={[]}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select start date' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select finish / due date' })).toBeTruthy();
    expect(screen.getByTestId('new-task-start-date')).toBeTruthy();
    expect(screen.getByTestId('new-task-finish-date')).toBeTruthy();
  });

  it('creates a typed project item with a next accountable action', async () => {
    const onSubmit = jest.fn();
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A']}
        projectAreas={[]}
        scheduleItems={[]}
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.changeText(screen.getByPlaceholderText('Example: East driveway striping'), 'Missing storefront glass');
    fireEvent.press(screen.getByText('Issue'));
    fireEvent.changeText(screen.getByPlaceholderText('Smallest accountable next step'), 'Confirm delivery date with glazing contractor');
    fireEvent.press(screen.getByText('Save Task'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      itemType: 'Issue',
      taskName: 'Missing storefront glass',
      nextAction: 'Confirm delivery date with glazing contractor',
    }));
  });

  it('exposes labeled inputs, selected radio choices, and accessible actions', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A']}
        projectAreas={[]}
        scheduleItems={[]}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Task or milestone')).toBeTruthy();
    expect(screen.getByLabelText('Percent Complete')).toBeTruthy();
    expect(screen.getByLabelText('Next action')).toBeTruthy();
    expect(screen.getByLabelText('Notes')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Task' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByRole('radio', { name: 'Issue' }).props.accessibilityState).toEqual({
      selected: false,
    });
    expect(screen.getByRole('button', { name: 'Save Task' })).toBeTruthy();
  });

  it('shows project-owned locations when the task project changes', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A', 'Project B']}
        projectAreas={[
          {
            id: 'area-a',
            name: 'Project A Yard',
            projectName: 'Project A',
            latitude: 34,
            longitude: -118,
            radiusFeet: 250,
          },
          {
            id: 'area-b',
            name: 'Project B Yard',
            projectName: 'Project B',
            latitude: 34,
            longitude: -118,
            radiusFeet: 250,
          },
        ]}
        scheduleItems={[]}
        initialProjectName="Project A"
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    // Owner answer Q31 (1 Oct 2026): Location no longer starts on the
    // project's first area; with no GPS fix it stays blank, and the choices
    // are the chosen project's areas.
    expect(screen.getByLabelText('Location').props.value).toBe('');
    fireEvent.press(screen.getByRole('button', { name: 'Choose Location' }));
    expect(screen.getByRole('radio', { name: 'Project A Yard' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Choose Project' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Project B' }));
    expect(screen.getByLabelText('Location').props.value).toBe('');
    expect(screen.getByRole('radio', { name: 'Project B Yard' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Project A Yard' })).toBeNull();
  });

  it('does not erase in-progress input when live project data refreshes', async () => {
    const initialProps = {
      visible: true,
      projects: ['Project A'],
      projectAreas: [{
        id: 'area-a',
        name: 'Original Yard',
        projectName: 'Project A',
        latitude: 34,
        longitude: -118,
        radiusFeet: 250,
      }],
      scheduleItems: [],
      initialProjectName: 'Project A',
      defaultOwner: 'David',
      onClose: jest.fn(),
      onSubmit: jest.fn(),
    };
    const screen = await render(<ScheduleTaskEditorModal {...initialProps} />);

    fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Typed work in progress');
    fireEvent.changeText(screen.getByLabelText('Location'), 'Manual field area');
    fireEvent.changeText(screen.getByLabelText('Owner'), 'Field superintendent');

    screen.rerender(
      <ScheduleTaskEditorModal
        {...initialProps}
        projectAreas={[
          ...initialProps.projectAreas,
          {
            id: 'area-new',
            name: 'Realtime cloud area',
            projectName: 'Project A',
            latitude: 34.1,
            longitude: -118.1,
            radiusFeet: 250,
          },
        ]}
      />,
    );

    expect(screen.getByDisplayValue('Typed work in progress')).toBeTruthy();
    expect(screen.getByDisplayValue('Manual field area')).toBeTruthy();
    expect(screen.getByDisplayValue('Field superintendent')).toBeTruthy();
  });

  it('keeps keyboard instructions proposed until the user applies the review', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A']}
        projectAreas={[{
          id: 'area-a',
          name: 'East Lobby',
          projectName: 'Project A',
          latitude: 34,
          longitude: -118,
          radiusFeet: 250,
        }]}
        scheduleItems={[]}
        initialProjectName="Project A"
        defaultOwner="David"
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Fill task with voice or text' }));
    fireEvent.changeText(
      screen.getByLabelText('Editable task instruction'),
      'Task: Install storefront glass; project: Project A; area: East Lobby; owner: David; percent: 50%;',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Review proposed task changes' }));

    expect(screen.getByText('Proposed field changes')).toBeTruthy();
    expect(screen.getByLabelText('Task or milestone').props.value).toBe('');
    expect(screen.getByRole('button', { name: 'Apply proposed changes to task form' }).props.accessibilityState?.disabled)
      .not.toBe(true);

    fireEvent.press(screen.getByRole('button', { name: 'Apply proposed changes to task form' }));
    expect(screen.getByLabelText('Task or milestone').props.value).toBe('Install storefront glass');
    expect(screen.getByLabelText('Location').props.value).toBe('East Lobby');
    expect(screen.getByLabelText('Owner').props.value).toBe('David');
    expect(screen.getByLabelText('Percent Complete').props.value).toBe('50');
    expect(screen.getByRole('radio', { name: 'In Progress' }).props.accessibilityState)
      .toEqual({ selected: true });
  });

  it('uses the shared voice transcript as editable mixed input before review', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A']}
        projectAreas={[{
          id: 'area-a',
          name: 'East Lobby',
          projectName: 'Project A',
          latitude: 34,
          longitude: -118,
          radiusFeet: 250,
        }]}
        scheduleItems={[]}
        initialProjectName="Project A"
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Fill task with voice or text' }));
    fireEvent.changeText(
      screen.getByLabelText('Editable task instruction'),
      'Task: Inspect storefront;',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Record task instruction' }));
    fireEvent.press(screen.getByRole('button', { name: 'Complete mock task recording' }));

    expect(screen.getByLabelText('Editable task instruction').props.value)
      .toBe('Task: Inspect storefront;\nTask: Inspect storefront; area: East Lobby; percent: 50%;');
    fireEvent.press(screen.getByRole('button', { name: 'Review proposed task changes' }));
    fireEvent.press(screen.getByRole('button', { name: 'Apply proposed changes to task form' }));
    expect(screen.getByLabelText('Task or milestone').props.value).toBe('Inspect storefront');
    expect(screen.getByLabelText('Location').props.value).toBe('East Lobby');
    expect(screen.getByLabelText('Percent Complete').props.value).toBe('50');
  });

  it('applies a voice-only task transcript only after review', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A']}
        projectAreas={[{
          id: 'area-a',
          name: 'East Lobby',
          projectName: 'Project A',
          latitude: 34,
          longitude: -118,
          radiusFeet: 250,
        }]}
        scheduleItems={[]}
        initialProjectName="Project A"
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Fill task with voice or text' }));
    fireEvent.press(screen.getByRole('button', { name: 'Record task instruction' }));
    fireEvent.press(screen.getByRole('button', { name: 'Complete mock task recording' }));

    expect(screen.getByLabelText('Task or milestone').props.value).toBe('');
    fireEvent.press(screen.getByRole('button', { name: 'Review proposed task changes' }));
    fireEvent.press(screen.getByRole('button', { name: 'Apply proposed changes to task form' }));
    expect(screen.getByLabelText('Task or milestone').props.value).toBe('Inspect storefront');
    expect(screen.getByLabelText('Location').props.value).toBe('East Lobby');
    expect(screen.getByLabelText('Percent Complete').props.value).toBe('50');
  });

  it('cancels an unapplied task-fill draft without altering the task form', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A']}
        projectAreas={[]}
        scheduleItems={[]}
        initialProjectName="Project A"
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Fill task with voice or text' }));
    fireEvent.changeText(
      screen.getByLabelText('Editable task instruction'),
      'Task: This should not apply; percent: 100%;',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Review proposed task changes' }));
    fireEvent.press(screen.getByRole('button', { name: 'Cancel task fill' }));

    expect(screen.getByLabelText('Task or milestone').props.value).toBe('');
    expect(screen.getByLabelText('Percent Complete').props.value).toBe('0');
    expect(screen.queryByLabelText('Editable task instruction')).toBeNull();
  });

  it('guides a Talk-created task through every field and records intentional skips', async () => {
    const onSubmit = jest.fn();
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        initiallyGuided
        projects={['Project A']}
        projectAreas={[{
          id: 'area-a',
          name: 'East Lobby',
          projectName: 'Project A',
          latitude: 34,
          longitude: -118,
          radiusFeet: 250,
        }]}
        scheduleItems={[]}
        initialProjectName="Project A"
        defaultOwner="David"
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    const saveAnswer = (label: string) => fireEvent.press(
      screen.getByRole('button', { name: `Save ${label} answer and continue` }),
    );
    const skipAnswer = (label: string) => fireEvent.press(
      screen.getByRole('button', { name: `Skip optional ${label}` }),
    );

    expect(screen.getByText('Question 1 of 14')).toBeTruthy();
    expect(screen.getByText('What should this task be called?')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Answer Task'), 'Install east lobby doors');
    saveAnswer('Task');
    saveAnswer('Item type');
    saveAnswer('Project');
    // Owner answer Q31: the area no longer starts on the first area; David answers it.
    fireEvent.changeText(screen.getByLabelText('Answer Area / location'), 'East Lobby');
    saveAnswer('Area / location');
    skipAnswer('Start date');
    skipAnswer('Finish / due date');
    skipAnswer('Milestone');
    saveAnswer('Owner');
    skipAnswer('Trade / contractor');
    saveAnswer('Percent complete');
    saveAnswer('Priority');
    saveAnswer('Status');
    fireEvent.changeText(screen.getByLabelText('Answer Next action'), 'Confirm delivery date');
    saveAnswer('Next action');
    skipAnswer('Notes');

    expect(screen.getByText('All task fields reviewed')).toBeTruthy();
    expect(screen.getByText(/5 optional fields were intentionally skipped/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Review completed task form' }));

    expect(screen.getByLabelText('Task or milestone').props.value).toBe('Install east lobby doors');
    expect(screen.getByLabelText('Next action').props.value).toBe('Confirm delivery date');
    fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      taskName: 'Install east lobby doors',
      projectName: 'Project A',
      locationName: 'East Lobby',
      owner: 'David',
      nextAction: 'Confirm delivery date',
    }));
  });

  it('applies a guided voice answer and advances to the next field automatically', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        initiallyGuided
        projects={['Project A']}
        projectAreas={[]}
        scheduleItems={[]}
        initialProjectName="Project A"
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByText('ECOS is ready for: Task')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Record answer for Task' }));
    fireEvent.press(screen.getByRole('button', { name: 'Complete mock task recording' }));

    expect(screen.getByText('Question 2 of 14')).toBeTruthy();
    expect(screen.getByText('ECOS is ready for: Item type')).toBeTruthy();
    expect(screen.getByLabelText('Task or milestone').props.value).toBe('Field Test 149');
  });

  // Owner answer Q31 (1 Oct 2026): the area is prefilled from GPS, not
  // from the project's first area.
  it('clears a prefilled optional area when the user skips it', async () => {
    let landFix: (fix: { latitude: number; longitude: number; accuracy: number }) => void = () => undefined;
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        initiallyGuided
        getLocationFix={() => new Promise(resolve => { landFix = resolve; })}
        projects={['Project A']}
        projectAreas={[{
          id: 'area-a',
          name: 'Prefilled Yard',
          projectName: 'Project A',
          latitude: 34,
          longitude: -118,
          radiusFeet: 250,
          locationCapturedAt: '2026-09-29T12:00:00.000Z',
        }]}
        scheduleItems={[]}
        initialProjectName="Project A"
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    await act(async () => landFix({ latitude: 34, longitude: -118, accuracy: 5 }));
    expect(screen.getByLabelText('Location').props.value).toBe('Prefilled Yard');
    fireEvent.changeText(screen.getByLabelText('Answer Task'), 'Field Test 149');
    fireEvent.press(screen.getByRole('button', { name: 'Save Task answer and continue' }));
    fireEvent.press(screen.getByRole('button', { name: 'Save Item type answer and continue' }));
    fireEvent.press(screen.getByRole('button', { name: 'Save Project answer and continue' }));
    expect(screen.getByLabelText('Answer Area / location').props.value).toBe('Prefilled Yard');

    fireEvent.press(screen.getByRole('button', { name: 'Skip optional Area / location' }));

    expect(screen.getByText('Question 5 of 14')).toBeTruthy();
    expect(screen.getByLabelText('Location').props.value).toBe('');
  });

  // Whole-app audit A3 pass 6 M1 (30 Sep 2026): Add Task offered closed
  // projects, defaulted to the newest project even once closed, and saved any
  // typed name; such a task never uploads.
  describe('offers and accepts open projects only', () => {
    const projectProps = {
      visible: true,
      // The newest project was just closed; the refresh keeps it on both lists.
      projects: ['2375 Main St', 'Lot 5'],
      closedProjects: ['2375 Main St'],
      projectRecords: [{ id: '72e941d8-8114-4082-a976-ae5b2b5daba9', name: '2375 Main St' }],
      projectAreas: [],
      scheduleItems: [],
    };
    let alert: jest.SpyInstance;
    beforeEach(() => {
      alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    });
    afterEach(() => alert.mockRestore());

    async function typeTask(onSubmit: jest.Mock, onClose = jest.fn(), extra: Record<string, unknown> = {}) {
      const screen = await render(
        <ScheduleTaskEditorModal {...projectProps} {...extra} onClose={onClose} onSubmit={onSubmit} />,
      );
      fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Stripe the lot');
      return screen;
    }

    it('defaults to the first open project and offers no closed one', async () => {
      const screen = await typeTask(jest.fn());
      expect(screen.getByLabelText('Project').props.value).toBe('Lot 5');
      fireEvent.press(screen.getByRole('button', { name: 'Choose Project' }));
      expect(screen.getByRole('radio', { name: 'Lot 5' })).toBeTruthy();
      expect(screen.queryByRole('radio', { name: '2375 Main St' })).toBeNull();
    });

    it('defaults to the project in view, unless it is closed', async () => {
      const open = await typeTask(jest.fn(), jest.fn(), { projects: ['Lot 5', 'Tower B'], initialProjectName: 'Tower B' });
      expect(open.getByLabelText('Project').props.value).toBe('Tower B');
      open.unmount();
      const closed = await typeTask(jest.fn(), jest.fn(), { initialProjectName: '2375 Main St' });
      expect(closed.getByLabelText('Project').props.value).toBe('Lot 5');
    });

    it.each([
      ['a typed new name', 'Lot 9 Typed', 'Project not found',
        'No open project is named “Lot 9 Typed”. Choose one from the list, or add it first with Add project on Overview.'],
      ['a closed project', '2375 main st', 'Project closed', '2375 Main St is closed. Reopen it on Overview to add tasks.'],
      ['a closed project by its id', '72e941d8-8114-4082-a976-ae5b2b5daba9', 'Project closed',
        '2375 Main St is closed. Reopen it on Overview to add tasks.'],
    ])('refuses %s and keeps the form open', async (_label, typed, title, message) => {
      const onSubmit = jest.fn();
      const onClose = jest.fn();
      const screen = await typeTask(onSubmit, onClose);
      fireEvent.changeText(screen.getByLabelText('Project'), typed);
      fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
      expect(alert).toHaveBeenCalledWith(title, message);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Task or milestone').props.value).toBe('Stripe the lot');
    });

    it('saves a typed open project under its exact name', async () => {
      const onSubmit = jest.fn();
      const screen = await typeTask(onSubmit);
      fireEvent.changeText(screen.getByLabelText('Project'), '  lot   5 ');
      fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
      expect(alert).not.toHaveBeenCalled();
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ projectName: 'Lot 5', taskName: 'Stripe the lot' }));
    });

    it('stays open with the typed task when the save is refused', async () => {
      const onClose = jest.fn();
      const screen = await typeTask(jest.fn(() => false), onClose);
      fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Task or milestone').props.value).toBe('Stripe the lot');
    });
  });

  // Whole-app audit A3 pass 7 L2 (30 Sep 2026): with Add Task open, closing
  // the default project elsewhere (or adding a project, which takes the top
  // of the list) switched the form to another project and wiped the typed
  // location and owner: "Lot 5 | Lot 5 Yard | David", and Save filed the task
  // under Lot 5. The form fills project, location and owner when it opens
  // (or when the project in view changes) and never changes what David typed.
  // Owner answer Q31 (1 Oct 2026): Location opens blank (no GPS fix here),
  // not on the project's first area ("Main St Yard" and the like).
  describe('keeps the form as filled and typed while the project lists change', () => {
    const area = (name: string, projectName: string) => ({
      id: `area-${name}`, name, projectName, latitude: 34, longitude: -118, radiusFeet: 250,
    });
    const listProps = {
      visible: true,
      projects: ['Main St', 'Lot 5', 'Tower B'],
      closedProjects: [] as string[],
      projectAreas: [area('Main St Yard', 'Main St'), area('Lot 5 Yard', 'Lot 5'), area('Tower B Yard', 'Tower B')],
      scheduleItems: [],
      defaultOwner: 'David',
      onClose: jest.fn(),
    };
    let alert: jest.SpyInstance;
    beforeEach(() => {
      alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    });
    afterEach(() => alert.mockRestore());

    const form = (screen: Awaited<ReturnType<typeof render>>) => ['Task or milestone', 'Project', 'Location', 'Owner']
      .map(label => screen.getByLabelText(label).props.value);

    it('leaves a default project closed elsewhere in the field, keeps what was typed, and Save refuses it', async () => {
      const onSubmit = jest.fn();
      const screen = await render(<ScheduleTaskEditorModal {...listProps} onSubmit={onSubmit} />);
      expect(form(screen)).toEqual(['', 'Main St', '', 'David']);
      fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Stripe the lot');
      fireEvent.changeText(screen.getByLabelText('Owner'), 'Field super');

      // Main St is closed on another device; the refresh keeps it on both lists.
      screen.rerender(<ScheduleTaskEditorModal {...listProps} closedProjects={['Main St']} onSubmit={onSubmit} />);
      expect(form(screen)).toEqual(['Stripe the lot', 'Main St', '', 'Field super']);

      fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
      expect(alert).toHaveBeenCalledWith('Project closed', 'Main St is closed. Reopen it on Overview to add tasks.');
      expect(onSubmit).not.toHaveBeenCalled();
      expect(form(screen)).toEqual(['Stripe the lot', 'Main St', '', 'Field super']);
    });

    it('keeps the project and typed fields when a new project takes the top of the list', async () => {
      const onSubmit = jest.fn();
      const props = { ...listProps, projects: ['Lot 5', 'Tower B'] };
      const screen = await render(<ScheduleTaskEditorModal {...props} onSubmit={onSubmit} />);
      expect(form(screen)).toEqual(['', 'Lot 5', '', 'David']);
      fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Stripe the lot');
      fireEvent.changeText(screen.getByLabelText('Location'), 'North gate');

      screen.rerender(<ScheduleTaskEditorModal {...props} projects={['Lot 9', 'Lot 5', 'Tower B']} onSubmit={onSubmit} />);
      expect(form(screen)).toEqual(['Stripe the lot', 'Lot 5', 'North gate', 'David']);

      fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
      expect(alert).not.toHaveBeenCalled();
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        taskName: 'Stripe the lot', projectName: 'Lot 5', locationName: 'North gate', owner: 'David',
      }));
    });

    // A3 pass 8 L1: an iPad rotated or resized across the wide layout while
    // the form was open changed the project in view; the form switched
    // project and kept the old project's location, filing the task under one
    // project with another's location. The form keeps what it opened with.
    it('keeps the project it opened with when the project in view changes', async () => {
      const onSubmit = jest.fn();
      const props = { ...listProps, initialProjectName: 'Tower B', onSubmit };
      const screen = await render(<ScheduleTaskEditorModal {...props} />);
      expect(form(screen)).toEqual(['', 'Tower B', '', 'David']);
      fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Seal roof');
      fireEvent.changeText(screen.getByLabelText('Location'), 'Tower B Roof');

      screen.rerender(<ScheduleTaskEditorModal {...props} initialProjectName={null} />);
      expect(form(screen)).toEqual(['Seal roof', 'Tower B', 'Tower B Roof', 'David']);
      screen.rerender(<ScheduleTaskEditorModal {...props} initialProjectName="Lot 5" />);
      expect(form(screen)).toEqual(['Seal roof', 'Tower B', 'Tower B Roof', 'David']);

      fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        taskName: 'Seal roof', projectName: 'Tower B', locationName: 'Tower B Roof',
      }));
    });

    it('fills the form afresh each time it opens', async () => {
      const props = { ...listProps, onSubmit: jest.fn() };
      const screen = await render(<ScheduleTaskEditorModal {...props} />);
      fireEvent.changeText(screen.getByLabelText('Owner'), 'Field super');
      screen.rerender(<ScheduleTaskEditorModal {...props} visible={false} />);
      screen.rerender(<ScheduleTaskEditorModal {...props} closedProjects={['Main St']} />);
      expect(form(screen)).toEqual(['', 'Lot 5', '', 'David']);
    });
  });

  // Whole-app audit A3 pass 9 L1 (30 Sep 2026): the form opened on Lot 9 and
  // "Fill task with voice or text" with "Task Seal roof, project Main St, due
  // tomorrow" saved the task under Main St with the location "Lot 9 Yard". In
  // guided mode the area question after the Main St answer offered "Lot 9
  // Yard" and both projects' areas. A fill that changes the project now resets
  // the location as the Project field does, unless it names one of the new
  // project's own areas, and the area choices are the chosen project's only.
  // Owner answer Q31 (1 Oct 2026): the reset location is no longer the new
  // project's first area but the area GPS places David in there, else blank
  // (no GPS fix in these tests); the form opens blank too.
  describe('a fill that changes the project brings that project\'s location', () => {
    const area = (name: string, projectName: string) => ({
      id: `area-${name}`, name, projectName, latitude: 34, longitude: -118, radiusFeet: 250,
    });
    const fillProps = {
      visible: true,
      projects: ['Lot 9', 'Main St'],
      projectAreas: [area('Lot 9 Yard', 'Lot 9'), area('Main St Yard', 'Main St'), area('Main St Roof', 'Main St')],
      scheduleItems: [],
      initialProjectName: 'Lot 9',
      defaultOwner: 'David',
      onClose: jest.fn(),
    };
    const fields = (screen: Awaited<ReturnType<typeof render>>) => ['Task or milestone', 'Project', 'Location']
      .map(label => screen.getByLabelText(label).props.value);

    async function typedFill(onSubmit: jest.Mock, instruction: string) {
      const screen = await render(<ScheduleTaskEditorModal {...fillProps} onSubmit={onSubmit} />);
      expect(fields(screen)).toEqual(['', 'Lot 9', '']);
      fireEvent.press(screen.getByRole('button', { name: 'Fill task with voice or text' }));
      fireEvent.changeText(screen.getByLabelText('Editable task instruction'), instruction);
      fireEvent.press(screen.getByRole('button', { name: 'Review proposed task changes' }));
      fireEvent.press(screen.getByRole('button', { name: 'Apply proposed changes to task form' }));
      return screen;
    }

    it('a typed fill naming another project saves with none of the old project\'s area, and no first area', async () => {
      const onSubmit = jest.fn();
      const screen = await typedFill(onSubmit, 'Task Seal roof, project Main St, due tomorrow');
      expect(fields(screen)).toEqual(['Seal roof', 'Main St', '']);
      fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        taskName: 'Seal roof', projectName: 'Main St', locationName: '',
      }));
    });

    it('keeps an area the fill names when it is the new project\'s own', async () => {
      const screen = await typedFill(jest.fn(), 'Task Seal roof, project Main St, area Main St Roof');
      expect(fields(screen)).toEqual(['Seal roof', 'Main St', 'Main St Roof']);
    });

    it('does not keep the old project\'s area even when the fill names it', async () => {
      const screen = await render(<ScheduleTaskEditorModal {...fillProps} onSubmit={jest.fn()} />);
      fireEvent.press(screen.getByRole('button', { name: 'Fill task with voice or text' }));
      fireEvent.changeText(screen.getByLabelText('Editable task instruction'), 'Task Seal roof, project Main St, area Lot 9 Yard');
      fireEvent.press(screen.getByRole('button', { name: 'Review proposed task changes' }));
      // Not one of Main St's areas, so the review asks before using it.
      fireEvent.press(screen.getByRole('button', { name: 'Confirm Area / location' }));
      fireEvent.press(screen.getByRole('button', { name: 'Apply proposed changes to task form' }));
      expect(fields(screen)).toEqual(['Seal roof', 'Main St', '']);
    });

    it('guided: the area question after another project offers that project\'s areas only', async () => {
      const screen = await render(<ScheduleTaskEditorModal {...fillProps} initiallyGuided onSubmit={jest.fn()} />);
      fireEvent.changeText(screen.getByLabelText('Answer Task'), 'Seal roof');
      fireEvent.press(screen.getByRole('button', { name: 'Save Task answer and continue' }));
      fireEvent.press(screen.getByRole('button', { name: 'Save Item type answer and continue' }));
      fireEvent.changeText(screen.getByLabelText('Answer Project'), 'Main St');
      fireEvent.press(screen.getByRole('button', { name: 'Save Project answer and continue' }));

      expect(screen.getByText('Where will this work happen?')).toBeTruthy();
      expect(screen.getByLabelText('Answer Area / location').props.value).toBe('');
      expect(screen.getByRole('radio', { name: 'Area / location Main St Yard' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Area / location Main St Roof' })).toBeTruthy();
      expect(screen.queryByRole('radio', { name: 'Area / location Lot 9 Yard' })).toBeNull();
      expect(fields(screen)).toEqual(['Seal roof', 'Main St', '']);
    });
  });

  // Whole-app audit A3 pass 9 L4 (30 Sep 2026): only a successful save
  // cleared the form. After X, the next Add Task refilled project, location
  // and owner but kept the cancelled task's name, notes, dates and type, and
  // guided questions pre-filled the cancelled task name. Closing the form
  // without saving (X or Back; it never asked before discarding) now discards
  // the attempt, so the form opens fresh.
  describe('opens fresh after it was closed without saving', () => {
    const area = (name: string, projectName: string) => ({
      id: `area-${name}`, name, projectName, latitude: 34, longitude: -118, radiusFeet: 250,
    });
    const freshProps = {
      projects: ['Lot 9', 'Main St'],
      projectAreas: [area('Lot 9 Yard', 'Lot 9'), area('Main St Yard', 'Main St')],
      scheduleItems: [],
      initialProjectName: 'Lot 9',
      defaultOwner: 'David',
    };

    it('X discards the cancelled task, and the next one saves with none of it', async () => {
      const onClose = jest.fn();
      const onSubmit = jest.fn();
      const props = { ...freshProps, onClose, onSubmit };
      const screen = await render(<ScheduleTaskEditorModal {...props} visible />);
      fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Seal roof');
      fireEvent.press(screen.getByRole('radio', { name: 'Issue' }));
      fireEvent.press(screen.getByRole('button', { name: '+7 Days' }));
      fireEvent.changeText(screen.getByLabelText('Contractor'), 'ABC Roofing');
      fireEvent.press(screen.getByRole('radio', { name: '50%' }));
      fireEvent.press(screen.getByRole('radio', { name: 'High' }));
      fireEvent.changeText(screen.getByLabelText('Milestone'), 'Dry-in');
      fireEvent.changeText(screen.getByLabelText('Next action'), 'Order membrane');
      fireEvent.changeText(screen.getByLabelText('Notes'), 'Wait for dry weather');
      fireEvent.changeText(screen.getByLabelText('Location'), 'North gate');
      fireEvent.press(screen.getByLabelText('Close Add Task'));
      expect(onClose).toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();

      screen.rerender(<ScheduleTaskEditorModal {...props} visible={false} />);
      screen.rerender(<ScheduleTaskEditorModal {...props} visible />);
      // Owner answer Q31 (1 Oct 2026): Location reopens blank, not on the first area.
      expect(['Task or milestone', 'Project', 'Location', 'Owner', 'Contractor', 'Percent Complete', 'Milestone', 'Next action', 'Notes']
        .map(label => screen.getByLabelText(label).props.value))
        .toEqual(['', 'Lot 9', '', 'David', '', '0', '', '', '']);
      expect(screen.getByRole('radio', { name: 'Task' }).props.accessibilityState).toEqual({ selected: true });

      fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Sweep the lot');
      fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        taskName: 'Sweep the lot', itemType: 'Task', projectName: 'Lot 9', locationName: '',
        startDate: '', finishDate: '', milestone: '', owner: 'David', contractor: '',
        percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', nextAction: '',
      }));
    });

    it('guided questions after X do not pre-fill the cancelled task name', async () => {
      const props = { ...freshProps, onClose: jest.fn(), onSubmit: jest.fn() };
      const screen = await render(<ScheduleTaskEditorModal {...props} visible />);
      fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Seal roof');
      fireEvent.press(screen.getByLabelText('Close Add Task'));
      screen.rerender(<ScheduleTaskEditorModal {...props} visible={false} />);
      screen.rerender(<ScheduleTaskEditorModal {...props} visible initiallyGuided />);
      expect(screen.getByText('Question 1 of 14')).toBeTruthy();
      expect(screen.getByLabelText('Answer Task').props.value).toBe('');
      expect(screen.getByLabelText('Task or milestone').props.value).toBe('');
    });
  });
});
