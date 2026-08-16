import { buildDAVEVoiceTaskPickerState } from '../../components/dave-voice-task-options';

const tasks = [
  { id: 'open-1', taskName: 'Install hand rails', detail: 'Canopy C · Not Started · 0%', isComplete: false },
  { id: 'open-2', taskName: 'Install side panels', detail: 'Canopy A · In Progress · 50%', isComplete: false },
  { id: 'done-1', taskName: 'Cure concrete', detail: 'Canopy C · Complete · 100%', isComplete: true },
  { id: 'done-2', taskName: 'Form column bases', detail: 'Canopy B · Complete · 100%', isComplete: true },
];

describe('DAVE voice task picker', () => {
  test('shows only open tasks by default', () => {
    const result = buildDAVEVoiceTaskPickerState({
      tasks,
      search: '',
      showCompleted: false,
      selectedTaskId: null,
    });

    expect(result.openCount).toBe(2);
    expect(result.completedCount).toBe(2);
    expect(result.visibleTasks.map(task => task.id)).toEqual(['open-1', 'open-2']);
  });

  test('shows completed tasks when explicitly requested', () => {
    const result = buildDAVEVoiceTaskPickerState({
      tasks,
      search: '',
      showCompleted: true,
      selectedTaskId: null,
    });

    expect(result.visibleTasks.map(task => task.id)).toEqual([
      'open-1',
      'open-2',
      'done-1',
      'done-2',
    ]);
  });

  test('search can find a completed task while completed tasks are hidden', () => {
    const result = buildDAVEVoiceTaskPickerState({
      tasks,
      search: 'cure concrete',
      showCompleted: false,
      selectedTaskId: null,
    });

    expect(result.visibleTasks.map(task => task.id)).toEqual(['done-1']);
  });

  test('keeps an intentionally selected completed task visible', () => {
    const result = buildDAVEVoiceTaskPickerState({
      tasks,
      search: '',
      showCompleted: false,
      selectedTaskId: 'done-2',
    });

    expect(result.visibleTasks.map(task => task.id)).toEqual(['open-1', 'open-2', 'done-2']);
  });
});
