import fs from 'node:fs';
import path from 'node:path';
import { createECOSTalkRequestAuthority } from '../../services/ECOSTalkRequestAuthority';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const projectA = '11111111-1111-4111-8111-111111111111';
const projectB = '22222222-2222-4222-8222-222222222222';

describe('ECOS Talk request authority', () => {
  it.each(['answer', 'task_action', 'capture_draft'] as const)(
    'drops late project A %s completion after the same question starts for project B',
    async kind => {
      const authority = createECOSTalkRequestAuthority();
      const pendingA = deferred<string>();
      const pendingB = deferred<string>();
      const applied: string[] = [];
      const ticketA = authority.begin({
        projectId: projectA,
        projectName: 'Shared Project',
        question: 'What changed?',
        taskId: null,
      });
      const completionA = pendingA.promise.then(value => {
        if (authority.isCurrent(ticketA)) applied.push(`${kind}:${value}`);
      });

      const ticketB = authority.begin({
        projectId: projectB,
        projectName: 'Shared Project',
        question: 'What changed?',
        taskId: null,
      });
      const completionB = pendingB.promise.then(value => {
        if (authority.isCurrent(ticketB)) applied.push(`${kind}:${value}`);
      });

      pendingB.resolve('B');
      await completionB;
      pendingA.resolve('A');
      await completionA;

      expect(applied).toEqual([`${kind}:B`]);
    },
  );

  it('drops a stale error after a different exact project becomes current', async () => {
    const authority = createECOSTalkRequestAuthority();
    const pendingA = deferred<string>();
    const visibleErrors: string[] = [];
    const ticketA = authority.begin({
      projectId: projectA,
      projectName: 'Shared Project',
      question: 'What changed?',
      taskId: null,
    });
    const completionA = pendingA.promise.catch(error => {
      if (authority.isCurrent(ticketA)) visibleErrors.push(String(error));
    });

    authority.begin({
      projectId: projectB,
      projectName: 'Shared Project',
      question: 'What changed?',
      taskId: null,
    });
    pendingA.reject(new Error('A failed'));
    await completionA;

    expect(visibleErrors).toEqual([]);
  });

  it('invalidates pending completion on modal/context cancellation', () => {
    const authority = createECOSTalkRequestAuthority();
    const ticket = authority.begin({
      projectId: projectA,
      projectName: ' Project   A ',
      question: ' What   changed? ',
      taskId: 'task-a',
    });
    expect(ticket.identity).toEqual({
      projectId: projectA,
      projectName: 'Project A',
      question: 'What changed?',
      taskId: 'task-a',
    });
    expect(authority.isCurrent(ticket)).toBe(true);
    authority.invalidate();
    expect(authority.isCurrent(ticket)).toBe(false);
  });

  it('wires every awaited Talk route to the monotonic authority before UI or error effects', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    const handler = app.slice(
      app.indexOf('async function handleTalkInput('),
      app.indexOf('function confirmTalkTaskAction()'),
    );
    expect(handler).toContain('const requestTicket = talkRequestAuthority.begin({');
    expect(handler).toContain('question: requestTicket.identity.question');
    expect(handler).toMatch(
      /history = await talkHistoryPersistence\.read\(projectId\);[\s\S]*?if \(!requestIsCurrent\(\)\) return;[\s\S]*?resolveDAVEConversationContext/,
    );
    expect(handler).toMatch(
      /talkDocuments = await loadECOSTalkReferenceDocuments\([\s\S]*?if \(!requestIsCurrent\(\)\) return;[\s\S]*?projectIntelligenceForTalk/,
    );
    for (const sink of ['setTalkAnswer({', 'setTalkTaskAction({', 'setTalkCaptureDraft(']) {
      const sinkIndex = handler.indexOf(sink);
      expect(sinkIndex).toBeGreaterThan(0);
      expect(handler.slice(Math.max(0, sinkIndex - 180), sinkIndex)).toContain(
        'if (!requestIsCurrent()) return;',
      );
    }
    expect(handler).toContain(
      'if (requestIsCurrent()) reportTalkAnswerPersistenceFailure(projectId, error);',
    );
    expect(app).toContain(
      'useEffect(() => () => talkRequestAuthority.invalidate(), [talkRequestAuthority]);',
    );
  });
});
