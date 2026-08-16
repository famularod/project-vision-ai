export type ECOSTalkRequestIdentity = Readonly<{
  projectId: string;
  projectName: string;
  question: string;
  taskId: string | null;
}>;

export type ECOSTalkRequestTicket = Readonly<{
  generation: number;
  identity: ECOSTalkRequestIdentity;
}>;

export type ECOSTalkRequestAuthority = Readonly<{
  begin: (identity: ECOSTalkRequestIdentity) => ECOSTalkRequestTicket;
  invalidate: () => void;
  isCurrent: (ticket: ECOSTalkRequestTicket) => boolean;
}>;

function normalizedDisplayText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizedIdentity(identity: ECOSTalkRequestIdentity): ECOSTalkRequestIdentity {
  return {
    projectId: identity.projectId,
    projectName: normalizedDisplayText(identity.projectName),
    question: normalizedDisplayText(identity.question),
    taskId: identity.taskId,
  };
}

function sameIdentity(left: ECOSTalkRequestIdentity, right: ECOSTalkRequestIdentity) {
  return left.projectId === right.projectId &&
    left.projectName === right.projectName &&
    left.question === right.question &&
    left.taskId === right.taskId;
}

/**
 * Owns the monotonic authority for Talk UI completions. Every new request or
 * project/task/input/modal transition invalidates all older tickets. Callers
 * must check `isCurrent` after each await and immediately before any visible
 * state change or persistence-error message.
 */
export function createECOSTalkRequestAuthority(): ECOSTalkRequestAuthority {
  let generation = 0;
  let current: ECOSTalkRequestTicket | null = null;

  return {
    begin(identity) {
      const ticket = Object.freeze({
        generation: ++generation,
        identity: Object.freeze(normalizedIdentity(identity)),
      });
      current = ticket;
      return ticket;
    },
    invalidate() {
      generation += 1;
      current = null;
    },
    isCurrent(ticket) {
      return current !== null &&
        current.generation === generation &&
        ticket.generation === current.generation &&
        sameIdentity(ticket.identity, current.identity);
    },
  };
}
