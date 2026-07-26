#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  analyzeProductionOperationsHealth,
  formatHealthSummary,
} = require('./production-operations-health-check');

const productionCheckSource = fs.readFileSync(
  require.resolve('./production-operations-health-check'),
  'utf8',
);
assert.match(
  productionCheckSource,
  /from\('dave_sync_tombstones'\)\s*\.select\('record_id',\s*\{\s*count:\s*'exact',\s*head:\s*true\s*\}\)/,
  'Production tombstone monitoring must count the existing record_id column.',
);

const NOW = new Date('2026-07-26T12:00:00.000Z');

const healthy = analyzeProductionOperationsHealth({
  cleanupRows: [],
  expiredDeletionReceiptCount: 0,
  stuckAIRequestRows: [],
  recentAIFailureRows: [],
  tombstoneCount: 42,
  now: NOW,
});
assert.equal(healthy.ok, true);
assert.equal(healthy.metrics.tombstoneCount, 42);
assert.match(formatHealthSummary(healthy), /operations health: PASS/);

const unhealthy = analyzeProductionOperationsHealth({
  cleanupRows: [
    {
      status: 'pending',
      attempt_count: 1,
      updated_at: '2026-07-24T10:00:00.000Z',
    },
    {
      status: 'failed',
      attempt_count: 3,
      updated_at: '2026-07-26T11:00:00.000Z',
    },
  ],
  expiredDeletionReceiptCount: 2,
  stuckAIRequestRows: [{ status: 'processing' }],
  recentAIFailureRows: [{ status: 'failed' }],
  tombstoneCount: 42,
  now: NOW,
});
assert.equal(unhealthy.ok, false);
assert.equal(unhealthy.metrics.staleCleanupCount, 1);
assert.equal(unhealthy.metrics.repeatedCleanupFailureCount, 1);
assert.equal(unhealthy.metrics.stuckAIRequestCount, 1);
assert.equal(unhealthy.warnings.length, 2);
const summary = formatHealthSummary(unhealthy);
assert.match(summary, /operations health: FAIL/);
assert.match(summary, /Release-blocking findings/);
assert.doesNotMatch(summary, /owner_id|object_path|service-role/i);

console.log(
  'Production operations health PASS: cleanup, AI, retention, and tombstone checks fail closed without exposing record details.',
);
