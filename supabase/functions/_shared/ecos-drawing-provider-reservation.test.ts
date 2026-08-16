import {
  assertEquals,
  assertRejects,
} from 'jsr:@std/assert@1.0.18';
import {
  beginECOSDrawingAnalysisOperation,
  createECOSDrawingProviderAttemptReservation,
  ecosVisualProviderOperationCanonicalBytes,
  ecosVisualProviderOperationId,
  normalizeECOSHostedDrawingProviderIdentity,
} from './ecos-drawing-provider-reservation.ts';
import fixtureJSON from '../../../workers/ecos-indexer/tests/visual_provider_operation_id_v1.json' with { type: 'json' };

const fixture = fixtureJSON as {
  canonicalBytes: string;
  requestIdentity: Record<string, unknown>;
};

Deno.test('matches the worker golden provider-operation bytes and SHA-256', async () => {
  const identity = fixture.requestIdentity as never;
  assertEquals(
    new TextDecoder().decode(ecosVisualProviderOperationCanonicalBytes(identity)),
    fixture.canonicalBytes,
  );
  assertEquals(
    await ecosVisualProviderOperationId(identity),
    fixture.requestIdentity.providerOperationId,
  );
  assertEquals(
    await normalizeECOSHostedDrawingProviderIdentity(
      fixture.requestIdentity,
      'low-confidence-ocr-17-3',
    ),
    fixture.requestIdentity,
  );
});

Deno.test('rejects stale operation IDs after any exact source/page/exception/claim mutation', async () => {
  for (const mutation of [
    { sourceSha256: 'c'.repeat(64) },
    { pageNumber: 18 },
    { visualExceptionFingerprint: 'd'.repeat(64) },
    { visualRegionKey: 'low-confidence-ocr-17-4' },
    { hostedClaimToken: '66666666-6666-4666-8666-666666666666' },
    { organizationId: 'pie-rls-validation-org-b' },
    { projectId: '2375 Compliance Project' },
    { documentId: 'web-document-other' },
  ]) {
    const mutated = { ...fixture.requestIdentity, ...mutation };
    assertEquals(
      await normalizeECOSHostedDrawingProviderIdentity(
        mutated,
        String(mutated.visualRegionKey),
      ),
      null,
    );
    assertEquals(
      await ecosVisualProviderOperationId(mutated as never) === fixture.requestIdentity.providerOperationId,
      false,
    );
  }
});

Deno.test('accepts exact live-shaped text IDs but rejects controls, blanks, and over-budget IDs', async () => {
  assertEquals(
    await normalizeECOSHostedDrawingProviderIdentity(
      fixture.requestIdentity,
      'low-confidence-ocr-17-3',
    ),
    fixture.requestIdentity,
  );
  const exactOuterSpaceIdentityWithoutOperation = {
    ...fixture.requestIdentity,
    projectId: ' 2321 Compliance Project ',
  };
  const exactOuterSpaceIdentity = {
    ...exactOuterSpaceIdentityWithoutOperation,
    providerOperationId: await ecosVisualProviderOperationId(
      exactOuterSpaceIdentityWithoutOperation as never,
    ),
  };
  assertEquals(
    await normalizeECOSHostedDrawingProviderIdentity(
      exactOuterSpaceIdentity,
      'low-confidence-ocr-17-3',
    ),
    exactOuterSpaceIdentity,
  );
  for (const mutation of [
    { organizationId: 'pie-rls-validation-org-a\nforged' },
    { projectId: '   ' },
    { projectId: '2321 Compliance Projéct' },
    { projectId: 'p'.repeat(501) },
    { documentId: 'd'.repeat(201) },
    { hostedJobId: '44444444-4444-4444-8444-44444444444A' },
  ]) {
    assertEquals(
      await normalizeECOSHostedDrawingProviderIdentity(
        { ...fixture.requestIdentity, ...mutation },
        'low-confidence-ocr-17-3',
      ),
      null,
    );
  }
});

Deno.test('begins the exact request and reserves monotonically unique provider attempts', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'ecos_begin_drawing_analysis') {
        return {
          data: {
            disposition: 'started',
            requestId: '77777777-7777-4777-8777-777777777777',
          },
          error: null,
        };
      }
      return { data: true, error: null };
    },
  };
  const identity = await normalizeECOSHostedDrawingProviderIdentity(
    fixture.requestIdentity,
    'low-confidence-ocr-17-3',
  );
  if (!identity) throw new Error('golden identity rejected');
  const operation = await beginECOSDrawingAnalysisOperation({
    client,
    identity,
    payloadSha256: 'e'.repeat(64),
    payloadBytes: 4096,
  });
  const reserve = createECOSDrawingProviderAttemptReservation({ client, operation });
  await reserve({ callRole: 'analysis_primary', provider: 'gemini', model: 'gemini-3.6-flash' });
  await reserve({ callRole: 'analysis_primary', provider: 'gemini', model: 'gemini-3.6-flash' });
  await reserve({ callRole: 'assurance', provider: 'openai', model: 'gpt-5.6-terra' });

  assertEquals(calls.map(call => call.name), [
    'ecos_begin_drawing_analysis',
    'ecos_reserve_drawing_provider_attempt',
    'ecos_reserve_drawing_provider_attempt',
    'ecos_reserve_drawing_provider_attempt',
  ]);
  assertEquals(calls.slice(1).map(call => call.args.p_call_ordinal), [1, 2, 3]);
  assertEquals(new Set(calls.slice(1).map(call => call.args.p_idempotency_key)).size, 3);
});

Deno.test('fails closed when begin or reservation authority is unavailable or denied', async () => {
  const identity = await normalizeECOSHostedDrawingProviderIdentity(
    fixture.requestIdentity,
    'low-confidence-ocr-17-3',
  );
  if (!identity) throw new Error('golden identity rejected');
  await assertRejects(
    () => beginECOSDrawingAnalysisOperation({
      client: { rpc: async () => ({ data: null, error: new Error('offline') }) },
      identity,
      payloadSha256: 'e'.repeat(64),
      payloadBytes: 4096,
    }),
    Error,
    'analysis_operation_control_unavailable',
  );

  const reserve = createECOSDrawingProviderAttemptReservation({
    client: { rpc: async () => ({ data: false, error: null }) },
    operation: {
      requestId: '77777777-7777-4777-8777-777777777777',
      providerOperationId: String(fixture.requestIdentity.providerOperationId),
      replayResponse: null,
    },
  });
  await assertRejects(
    () => reserve({ callRole: 'analysis_primary', provider: 'openai', model: 'gpt-5.6-terra' }),
    Error,
    'drawing_provider_reservation_denied',
  );
});
