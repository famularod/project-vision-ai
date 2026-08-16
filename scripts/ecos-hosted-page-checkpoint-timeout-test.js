const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read(
  'supabase/migrations/20260814072356_ecos_hosted_page_checkpoint_timeout.sql',
);
const gateway = read('workers/ecos-indexer/ecos_indexer/gateway.py');

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

expect(
  migration.includes('alter function public.ecos_checkpoint_hosted_index_page(') &&
    migration.includes("set statement_timeout = '300s'"),
  'The protected page checkpoint RPC must have a bounded 300-second database limit',
);
expect(
  !migration.includes("statement_timeout = '0'") &&
    !migration.includes('ecos_commit_hosted_index_job') &&
    !migration.includes('ecos_hosted_document_pages') &&
    !migration.includes('ecos_hosted_document_chunks'),
  'The timeout migration must not disable limits or cross publication boundaries',
);
expect(
  gateway.includes('DEFAULT_RPC_READ_TIMEOUT_SECONDS = 180') &&
    gateway.includes('PAGE_CHECKPOINT_RPC_READ_TIMEOUT_SECONDS = 330') &&
    gateway.includes('if name == "ecos_checkpoint_hosted_index_page"'),
  'Only the protected page checkpoint transport may receive the bounded margin',
);
expect(
  gateway.includes('timeout=(10, read_timeout_seconds)'),
  'The selected bounded timeout must reach the HTTP request',
);

console.log('ECOS hosted page checkpoint timeout contract: PASS');
