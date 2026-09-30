/**
 * Owner answer Q21 (30 Sep 2026): the PIE vision evaluation harness signs in
 * with an account and signs out when it finishes. It used auth-js's default,
 * scope 'global', which would sign that account out on every device (the
 * owner's iPhone, iPad and computer when it is his account). It now signs out
 * its own session only. supabase-js is replaced; nothing leaves this machine.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockSignOut = jest.fn(async (_options?: unknown) => ({ error: null }));
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      signInWithPassword: jest.fn(async () => ({ data: { session: { access_token: 'harness' } }, error: null })),
      signOut: mockSignOut,
    },
    functions: {
      invoke: jest.fn(async () => ({ data: { photoPairContract: {} }, error: null })),
    },
  })),
}));

const ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PIE_EVAL_USER_EMAIL', 'PIE_EVAL_USER_PASSWORD'] as const;
const saved = Object.fromEntries(ENV.map(name => [name, process.env[name]]));

afterAll(() => {
  ENV.forEach(name => {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  });
});

test('the evaluation harness signs out its own session only (scope local)', async () => {
  process.env.SUPABASE_URL = 'https://harness-q21.invalid';
  process.env.SUPABASE_ANON_KEY = 'q21-anon-key-not-a-secret';
  process.env.PIE_EVAL_USER_EMAIL = 'harness@example.com';
  process.env.PIE_EVAL_USER_PASSWORD = 'not-a-real-password';
  const fixturePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'q21-harness-')), 'fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify({ cases: [{ id: 'case-without-live-evidence', expected: {} }] }));
  const { runEvaluation } = require('../../scripts/pie-vision-evaluation-harness');

  await runEvaluation({ fixturePath });

  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  fs.rmSync(path.dirname(fixturePath), { recursive: true, force: true });
});
