import { assertEquals } from 'jsr:@std/assert@1';
import { createECOSEmbeddingProviderHandler } from './index.ts';

const vector = Array.from({ length: 1536 }, () => 0.001);
const handler = createECOSEmbeddingProviderHandler({
  serviceRoleKey: 'service-role',
  workerToken: 'worker-token',
  openAIKey: 'provider-key',
  fetchImplementation: (_input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get('Authorization') !== 'Bearer provider-key') {
      return Promise.resolve(new Response('{}', { status: 403 }));
    }
    return Promise.resolve(new Response(JSON.stringify({
      data: [{ index: 0, embedding: vector }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  },
});

Deno.test('embedding bridge rejects browser and invalid credentials', async () => {
  const browser = await handler(new Request('https://bridge.test', {
    method: 'POST',
    headers: { origin: 'https://customer.test' },
    body: '{}',
  }));
  assertEquals(browser.status, 403);
  const unauthorized = await handler(new Request('https://bridge.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong' },
    body: '{}',
  }));
  assertEquals(unauthorized.status, 403);
});

Deno.test('embedding bridge returns only validated embeddings', async () => {
  const response = await handler(new Request('https://bridge.test', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer service-role',
      'x-ecos-worker-token': 'worker-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: ['north lot concrete thickness'],
      dimensions: 1536,
      encoding_format: 'float',
    }),
  }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.length, 1);
  assertEquals(body.data[0].index, 0);
  assertEquals(body.data[0].embedding.length, 1536);
  assertEquals(Object.keys(body).sort(), ['data']);
});

Deno.test('embedding bridge rejects unbounded or caller-selected provider shapes', async () => {
  const response = await handler(new Request('https://bridge.test', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer service-role',
      'x-ecos-worker-token': 'worker-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'caller-selected-model',
      input: ['evidence'],
      dimensions: 1536,
      encoding_format: 'float',
    }),
  }));
  assertEquals(response.status, 502);
});
