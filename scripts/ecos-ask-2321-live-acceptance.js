#!/usr/bin/env node

process.env.ECOS_LIVE_ACCEPTANCE_DEFINITION =
  process.env.ECOS_LIVE_ACCEPTANCE_DEFINITION ||
  'validation/ecos/ask-ecos-2321-real-world-cases.json';
process.env.ECOS_LIVE_ACCEPTANCE_RESULT =
  process.env.ECOS_LIVE_ACCEPTANCE_RESULT ||
  'validation/output/ecos-ask-2321-live-acceptance.json';

const { main } = require('./ecos-ask-live-acceptance');

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  console.error(`Ask ECOS 2321 acceptance could not run: ${message.slice(0, 1_000)}`);
  process.exitCode = 1;
});
