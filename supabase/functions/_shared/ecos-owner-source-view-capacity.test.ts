import { createECOSOwnerSourceViewHandler as create } from './ecos-owner-source-view-handler.ts';

const projectId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const grant = { projectId, ownerId, organizationId: ownerId };
const request = (signal?: AbortSignal) => new Request('https://example.test/source', {
  method: 'POST', signal, headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
  body: JSON.stringify({ schemaVersion: 'ecos-owner-source-view/2.2',
    answerSchemaVersion: 'ecos-owner-source-answer/2.1', projectId,
    requestId: crypto.randomUUID(), citation: { kind: 'visual_page' } }),
});
function assert(value: unknown): asserts value { if (!value) throw Error('Assertion failed'); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; }

Deno.test('source capacity: three same-owner devices overlap, fourth rejected, slots recover', async () => {
  const entered = [deferred(), deferred(), deferred()]; const finish = deferred();
  let calls = 0, authCalls = 0;
  const handler = create({ enabled: true, maxConcurrent: 3, maxConcurrentPerOwner: 3,
    authorize: async () => { authCalls++; return grant; },
    resolve: async () => { entered[calls++]?.resolve(); await finish.promise; return { proof: true }; },
  });
  const pending = [handler(request()), handler(request()), handler(request())];
  try {
    await Promise.all(entered.map(x => x.promise));
    assert((await handler(request())).status === 429);
    assert(calls === 3);
  } finally { finish.resolve(); }
  assert((await Promise.all(pending)).every(x => x.status === 200));
  assert(authCalls === 6); // Before AND after each independent source read.
  assert((await handler(request())).status === 200);
});

Deno.test('source capacity: default per-owner limit remains one and denial does not release another slot', async () => {
  const entered = deferred(), finish = deferred();
  const handler = create({ enabled: true, maxConcurrent: 3,
    authorize: async () => grant,
    resolve: async () => { entered.resolve(); await finish.promise; return {}; },
  });
  const first = handler(request()); await entered.promise;
  try {
    assert((await handler(request())).status === 429);
    assert((await handler(request())).status === 429);
  } finally { finish.resolve(); }
  assert((await first).status === 200);
  assert((await handler(request())).status === 200);
});

Deno.test('source capacity: cancellation holds slot until abandoned resolver settles', async () => {
  const entered = deferred(), finish = deferred(), controller = new AbortController();
  const handler = create({ enabled: true, maxConcurrent: 1,
    authorize: async () => grant,
    resolve: async () => { entered.resolve(); await finish.promise; return {}; },
  });
  const first = handler(request(controller.signal)); await entered.promise;
  controller.abort(); assert((await first).status === 503);
  try { assert((await handler(request())).status === 429); }
  finally { finish.resolve(); }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert((await handler(request())).status === 200);
});

Deno.test('source capacity: revoked authorization still rejects after a completed read', async () => {
  let calls = 0;
  const handler = create({ enabled: true, maxConcurrent: 3, maxConcurrentPerOwner: 3,
    authorize: async () => ++calls === 1 ? grant : null, resolve: async () => ({}) });
  assert((await handler(request())).status === 403);
});

Deno.test('source capacity: invalid owner bounds rejected at server assembly', () => {
  for (const maxConcurrentPerOwner of [0, -1, 4, 1.5, NaN]) {
    let rejected = false;
    try { create({ enabled: true, maxConcurrent: 3, maxConcurrentPerOwner,
      authorize: async () => grant, resolve: async () => ({}) }); }
    catch { rejected = true; }
    assert(rejected);
  }
});
