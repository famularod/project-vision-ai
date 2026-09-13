import {
  buildECOSEvidenceDossierReceipt,
  buildECOSEvidenceSnapshotReceipt,
  createECOSQuestionTraceClock,
  enterECOSQuestionTraceStage,
  finishECOSQuestionTraceClock,
  normalizeECOSClientSurface,
  normalizeECOSResponseClientSurface,
  normalizedRequestId,
  stableStringify,
} from './ecos-question-observability.ts';

Deno.test('question trace records deterministic stage durations without prompt text', () => {
  const clock = createECOSQuestionTraceClock(1_000);
  enterECOSQuestionTraceStage(clock, 'gather_evidence', 1_025);
  enterECOSQuestionTraceStage(clock, 'provider_request', 1_100);
  const finished = finishECOSQuestionTraceClock(clock, 1_140);
  if (stableStringify(finished.stageDurationsMs) !== '{"gather_evidence":75,"provider_request":40,"request_received":25}') {
    throw new Error(`Unexpected durations ${stableStringify(finished.stageDurationsMs)}`);
  }
});

Deno.test('evidence receipts are content-addressed and omit raw evidence', async () => {
  const sources = [{
    id: 'document-secret-id',
    sourceType: 'document',
    updatedAt: '2026-09-08T00:00:00.000Z',
    excerpt: 'NORTH LOT PCC 6 INCHES',
    citation: { page: 4 },
  }];
  const inventory = {
    consistency: 'best_effort_non_atomic' as const,
    sourceCounts: { documents: 1 },
    sourceVersions: { documents: '2026-09-08T00:00:00.000Z' },
    unavailableChannels: [] as string[],
    limitations: ['Atomic cross-table snapshot is not yet available.'],
    candidateCount: 1,
  };
  const first = await buildECOSEvidenceSnapshotReceipt({ sources, inventory });
  const second = await buildECOSEvidenceSnapshotReceipt({ sources, inventory });
  if (first.snapshotSha256 !== second.snapshotSha256) throw new Error('Snapshot hashes must be deterministic.');
  const dossier = await buildECOSEvidenceDossierReceipt({
    question: 'How thick is the north lot concrete?',
    snapshot: first,
    candidates: sources,
    selected: sources,
    assuranceContract: 'test/1.0',
  });
  const serialized = JSON.stringify({ first, dossier });
  if (serialized.includes('NORTH LOT') || serialized.includes('document-secret-id')) {
    throw new Error('Receipts must not persist raw evidence or source ids.');
  }
});

Deno.test('client identity and surface parsing fail closed', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  if (normalizedRequestId(requestId) !== requestId) throw new Error('Expected UUID request id.');
  if (normalizedRequestId('not-a-uuid') !== null) throw new Error('Invalid request ids must be rejected.');
  if (normalizeECOSClientSurface('ipad', '') !== 'ipad') throw new Error('Expected iPad surface.');
  if (normalizeECOSClientSurface('web', 'shadow') !== 'shadow') throw new Error('Shadow must remain distinct.');
  if (normalizeECOSClientSurface('fake', '') !== 'unknown') throw new Error('Unknown surface must fail closed.');
});

Deno.test('customer diagnostics preserve the originating device while shadow execution stays isolated', () => {
  if (normalizeECOSResponseClientSurface('shadow', 'web') !== 'web') {
    throw new Error('A shadow-routed web request must return web-compatible diagnostics.');
  }
  if (normalizeECOSResponseClientSurface('shadow', 'iphone') !== 'iphone') {
    throw new Error('A shadow-routed iPhone request must return iPhone-compatible diagnostics.');
  }
  if (normalizeECOSResponseClientSurface('shadow', 'shadow') !== 'unknown') {
    throw new Error('An internal shadow surface must not escape into the customer response contract.');
  }
  if (normalizeECOSResponseClientSurface('ipad', 'unknown') !== 'ipad') {
    throw new Error('A live customer surface must remain unchanged.');
  }
});
