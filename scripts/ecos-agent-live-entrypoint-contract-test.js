const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const gateway = fs.readFileSync(
  path.join(root, 'supabase/functions/ecos-agent-customer-gateway/index.ts'),
  'utf8',
);
const liveEntrypoint = fs.readFileSync(
  path.join(root, 'supabase/functions/ecos-ask-project/index.ts'),
  'utf8',
);

assert.match(gateway, /export function serveECOSAgentCustomerGateway\(\)/);
assert.match(gateway, /if \(import\.meta\.main\) serveECOSAgentCustomerGateway\(\);/);
assert.equal(
  liveEntrypoint,
  'import { serveECOSAgentCustomerGateway } from "../ecos-agent-customer-gateway/index.ts";\n\nserveECOSAgentCustomerGateway();\n',
);
assert.doesNotMatch(liveEntrypoint, /privateOwnerAgentBody|proxyClassic|Deno\.env\.get/);

console.log('PASS ECOS live entrypoint uses the single customer gateway implementation');
