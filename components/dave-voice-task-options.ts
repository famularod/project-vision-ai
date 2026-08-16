export type DAVEVoiceTaskOption = {
  id: string;
  taskName: string;
  detail: string;
  isComplete?: boolean;
};

export function buildDAVEVoiceTaskPickerState({
  tasks,
  search,
  showCompleted,
  selectedTaskId,
  limit = 10,
}: {
  tasks: readonly DAVEVoiceTaskOption[];
  search: string;
  showCompleted: boolean;
  selectedTaskId: string | null;
  limit?: number;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const completedCount = tasks.filter(task => task.isComplete).length;
  const openCount = tasks.length - completedCount;
  const visibleTasks = tasks
    .filter(task =>
      !normalizedSearch ||
      `${task.taskName} ${task.detail}`.toLowerCase().includes(normalizedSearch),
    )
    .filter(task =>
      Boolean(normalizedSearch) ||
      showCompleted ||
      !task.isComplete ||
      task.id === selectedTaskId,
    )
    .slice(0, limit);

  return {
    completedCount,
    openCount,
    visibleTasks,
  };
}
