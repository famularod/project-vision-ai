export type DAVETaskStatus = 'Not Started' | 'In Progress' | 'Waiting' | 'Complete';

export type DAVETaskUpdateCommand = Readonly<{
  taskReference: string;
  changes: Readonly<{
    status?: DAVETaskStatus;
    percentComplete?: number;
  }>;
  changeSummary: string;
}>;

export type DAVETaskCandidate = {
  id: string;
  taskName: string;
  locationName?: string | null;
};

export function parseDAVETaskUpdateCommand(transcript: string): DAVETaskUpdateCommand | null {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!/^(?:mark|set|change|update)\b/i.test(text)) return null;

  const statusMatch = text.match(
    /^(?:mark|set|change|update)\s+(.+?)\s+(?:as\s+|to\s+)?(not\s+started|in\s+progress|waiting|complete|completed|done)[.!]?$/i,
  );
  if (statusMatch) {
    const status = normalizedStatus(statusMatch[2]);
    const changes = status === 'Complete'
      ? { status, percentComplete: 100 }
      : status === 'Not Started'
        ? { status, percentComplete: 0 }
        : { status };
    return {
      taskReference: statusMatch[1].trim(),
      changes,
      changeSummary: status === 'Complete'
        ? 'Mark complete and set progress to 100%'
        : status === 'Not Started'
          ? 'Mark not started and set progress to 0%'
          : `Change status to ${status}`,
    };
  }

  const percentMatch = text.match(
    /^(?:mark|set|change|update)\s+(.+?)\s+(?:to|at)\s+(\d{1,3})\s*(?:%|percent)[.!]?$/i,
  );
  if (!percentMatch) return null;
  const percentComplete = Math.max(0, Math.min(100, Number(percentMatch[2])));
  return {
    taskReference: percentMatch[1].trim(),
    changes: {
      percentComplete,
      ...(percentComplete === 100
        ? { status: 'Complete' as const }
        : percentComplete === 0
          ? { status: 'Not Started' as const }
          : { status: 'In Progress' as const }),
    },
    changeSummary: `Set progress to ${percentComplete}%${percentComplete === 100 ? ' and mark complete' : ''}`,
  };
}

export function findDAVETaskCandidates<T extends DAVETaskCandidate>(
  command: DAVETaskUpdateCommand,
  tasks: readonly T[],
): T[] {
  const reference = normalize(command.taskReference);
  if (!reference) return [];
  const activeTasks = tasks.filter(task => task.id && task.taskName.trim());
  const exact = activeTasks.filter(task => normalize(task.taskName) === reference);
  if (exact.length > 0) return exact;

  const contained = activeTasks.filter(task => {
    const taskName = normalize(task.taskName);
    const fullLabel = normalize(`${task.taskName} ${task.locationName || ''}`);
    return taskName.includes(reference) || reference.includes(taskName) || fullLabel.includes(reference);
  });
  if (contained.length > 0) return contained;

  const referenceTokens = reference.split(' ').filter(token => token.length > 1);
  if (referenceTokens.length === 0) return [];
  return activeTasks.filter(task => {
    const candidate = normalize(`${task.taskName} ${task.locationName || ''}`);
    return referenceTokens.every(token => candidate.includes(token));
  });
}

function normalizedStatus(value: string): DAVETaskStatus {
  const status = normalize(value);
  if (status === 'not started') return 'Not Started';
  if (status === 'in progress') return 'In Progress';
  if (status === 'waiting') return 'Waiting';
  return 'Complete';
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
