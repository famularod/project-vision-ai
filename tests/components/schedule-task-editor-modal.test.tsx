import { fireEvent, render } from '@testing-library/react-native';
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

    expect(screen.getByDisplayValue('Project A Yard')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Choose Project' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Project B' }));
    expect(screen.getByDisplayValue('Project B Yard')).toBeTruthy();
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

  it('clears a prefilled optional area when the user skips it', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        initiallyGuided
        projects={['Project A']}
        projectAreas={[{
          id: 'area-a',
          name: 'Prefilled Yard',
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
      expect(form(screen)).toEqual(['', 'Main St', 'Main St Yard', 'David']);
      fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Stripe the lot');
      fireEvent.changeText(screen.getByLabelText('Owner'), 'Field super');

      // Main St is closed on another device; the refresh keeps it on both lists.
      screen.rerender(<ScheduleTaskEditorModal {...listProps} closedProjects={['Main St']} onSubmit={onSubmit} />);
      expect(form(screen)).toEqual(['Stripe the lot', 'Main St', 'Main St Yard', 'Field super']);

      fireEvent.press(screen.getByRole('button', { name: 'Save Task' }));
      expect(alert).toHaveBeenCalledWith('Project closed', 'Main St is closed. Reopen it on Overview to add tasks.');
      expect(onSubmit).not.toHaveBeenCalled();
      expect(form(screen)).toEqual(['Stripe the lot', 'Main St', 'Main St Yard', 'Field super']);
    });

    it('keeps the project and typed fields when a new project takes the top of the list', async () => {
      const onSubmit = jest.fn();
      const props = { ...listProps, projects: ['Lot 5', 'Tower B'] };
      const screen = await render(<ScheduleTaskEditorModal {...props} onSubmit={onSubmit} />);
      expect(form(screen)).toEqual(['', 'Lot 5', 'Lot 5 Yard', 'David']);
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

    it('follows a new project in view only in the fields David has not changed', async () => {
      const props = { ...listProps, initialProjectName: 'Lot 5', onSubmit: jest.fn() };
      const screen = await render(<ScheduleTaskEditorModal {...props} />);
      expect(form(screen)).toEqual(['', 'Lot 5', 'Lot 5 Yard', 'David']);
      fireEvent.changeText(screen.getByLabelText('Owner'), 'Field super');

      screen.rerender(<ScheduleTaskEditorModal {...props} initialProjectName="Tower B" />);
      expect(form(screen)).toEqual(['', 'Tower B', 'Tower B Yard', 'Field super']);
    });

    it('fills the form afresh each time it opens', async () => {
      const props = { ...listProps, onSubmit: jest.fn() };
      const screen = await render(<ScheduleTaskEditorModal {...props} />);
      fireEvent.changeText(screen.getByLabelText('Owner'), 'Field super');
      screen.rerender(<ScheduleTaskEditorModal {...props} visible={false} />);
      screen.rerender(<ScheduleTaskEditorModal {...props} closedProjects={['Main St']} />);
      expect(form(screen)).toEqual(['', 'Lot 5', 'Lot 5 Yard', 'David']);
    });
  });
});
