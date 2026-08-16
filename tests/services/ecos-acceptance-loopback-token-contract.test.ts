import fs from 'node:fs';
import path from 'node:path';

describe('ECOS live acceptance authentication boundary', () => {
  const gateway = fs.readFileSync(path.join(
    process.cwd(),
    'services/DAVEWebSupabaseClient.ts',
  ), 'utf8');
  const acceptance = fs.readFileSync(path.join(
    process.cwd(),
    'scripts/ecos-ask-live-acceptance.js',
  ), 'utf8');
  const route = fs.readFileSync(path.join(
    process.cwd(),
    'app/ecos-acceptance.tsx',
  ), 'utf8');

  it('never sends a reusable browser session bearer to loopback', () => {
    expect(gateway).not.toContain('authorizeLocalAcceptanceBridge');
    expect(gateway).not.toMatch(/127\.0\.0\.1:\$\{input\.port\}/);
    expect(route).not.toContain('DAVEWebSupabaseClient');
    expect(route).not.toContain('useLocalSearchParams');
    expect(route).not.toMatch(/Authorization\s*:/);
    expect(route).not.toContain('fetch(');
    expect(route).toContain('No browser token was shared');
  });

  it('has no loopback listener, URL-selected port/nonce, or browser-auth receiver', () => {
    expect(acceptance).not.toContain("require('node:http')");
    expect(acceptance).not.toContain('http.createServer');
    expect(acceptance).not.toContain('server.listen');
    expect(acceptance).not.toContain("request.url !== '/authorize'");
    expect(acceptance).not.toContain('ECOS_LIVE_BROWSER_AUTH');
    expect(acceptance).not.toContain('ECOS_LIVE_BROWSER_ORIGIN');
    expect(acceptance).not.toContain('receiveAccessTokenFromLocalBrowser');
    expect(acceptance).not.toMatch(/ecos-acceptance\?port=.*nonce=/);
  });

  it('retains only explicit process-local authentication inputs', () => {
    expect(acceptance).toContain('process.env.ECOS_LIVE_ACCESS_TOKEN');
    expect(acceptance).toContain('process.env.ECOS_LIVE_TEST_EMAIL');
    expect(acceptance).toContain('process.env.ECOS_LIVE_TEST_PASSWORD');
    expect(acceptance).toContain('Credentials are never written to the result file.');
  });
});
