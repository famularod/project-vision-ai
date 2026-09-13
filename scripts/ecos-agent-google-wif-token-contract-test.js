#!/usr/bin/env node

const assert = require('node:assert/strict');
const { mintCloudRunIdToken } = require('./ecos-agent-google-wif-token');

async function main() {
  const requests = [];
  const responses = [
    response(200, { access_token: 'federated-token' }),
    response(200, { token: 'cloud-run-id-token' }),
  ];
  const token = await mintCloudRunIdToken({
    subjectToken: 'owner-supabase-jwt',
    providerResource:
      '//iam.googleapis.com/projects/921260032086/locations/global/workloadIdentityPools/ecos-owner-preview/providers/owner-supabase',
    serviceAccountEmail:
      'ecos-owner-preview-invoker@vitruvius-project-intelligence.iam.gserviceaccount.com',
    serviceAudience:
      'https://ecos-agent-query-preview-vjn77z65la-uw.a.run.app',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return responses.shift();
    },
  });
  assert.equal(token, 'cloud-run-id-token');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://sts.googleapis.com/v1/token');
  const exchange = new URLSearchParams(requests[0].options.body);
  assert.equal(exchange.get('subject_token'), 'owner-supabase-jwt');
  assert.equal(
    exchange.get('subject_token_type'),
    'urn:ietf:params:oauth:token-type:jwt',
  );
  assert.equal(
    exchange.get('audience'),
    '//iam.googleapis.com/projects/921260032086/locations/global/workloadIdentityPools/ecos-owner-preview/providers/owner-supabase',
  );
  assert.match(requests[1].url, /:generateIdToken$/);
  assert.equal(
    requests[1].options.headers.Authorization,
    'Bearer federated-token',
  );
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    audience: 'https://ecos-agent-query-preview-vjn77z65la-uw.a.run.app',
    includeEmail: true,
  });

  await assert.rejects(
    mintCloudRunIdToken({
      subjectToken: 'owner-supabase-jwt',
      providerResource: 'https://iam.googleapis.com/not-a-provider',
      serviceAccountEmail: 'invalid',
      serviceAudience: 'https://tag---service.run.app',
      fetchImpl: async () => response(500, {}),
    }),
    /providerResource must be a workload identity provider resource/,
  );

  await assert.rejects(
    mintCloudRunIdToken({
      subjectToken: 'owner-supabase-jwt',
      providerResource:
        '//iam.googleapis.com/projects/921260032086/locations/global/workloadIdentityPools/ecos-owner-preview/providers/owner-supabase',
      serviceAccountEmail:
        'ecos-owner-preview-invoker@vitruvius-project-intelligence.iam.gserviceaccount.com',
      serviceAudience:
        'https://candidate-private---ecos-agent-query-preview-vjn77z65la-uw.a.run.app',
      fetchImpl: async () => response(500, {}),
    }),
    /serviceAudience must be the untagged Cloud Run service URL/,
  );

  await assert.rejects(
    mintCloudRunIdToken({
      subjectToken: 'secret-owner-token',
      providerResource:
        '//iam.googleapis.com/projects/921260032086/locations/global/workloadIdentityPools/ecos-owner-preview/providers/owner-supabase',
      serviceAccountEmail:
        'ecos-owner-preview-invoker@vitruvius-project-intelligence.iam.gserviceaccount.com',
      serviceAudience:
        'https://ecos-agent-query-preview-vjn77z65la-uw.a.run.app',
      fetchImpl: async () => response(403, { error: 'do not leak secret-owner-token' }),
    }),
    (error) => {
      assert.equal(error.message, 'workload_identity_exchange_failed:403');
      assert.doesNotMatch(error.message, /secret-owner-token/);
      return true;
    },
  );

  console.log('PASS ecos agent Google WIF token contract');
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
