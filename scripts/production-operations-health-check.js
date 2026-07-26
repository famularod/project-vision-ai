#!/usr/bin/env node

const fs = require('node:fs');
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = require('ws');
}
const { createClient } = require('@supabase/supabase-js');

const HOUR_MS = 60 * 60 * 1000;
const CLEANUP_STALE_HOURS = 24;
const AI_STALE_MINUTES = 15;
const REPEATED_CLEANUP_ATTEMPTS = 3;

function finiteInteger(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function timeIsAtOrBefore(value, cutoff) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed <= cutoff.getTime();
}

function analyzeProductionOperationsHealth({
  cleanupRows,
  expiredDeletionReceiptCount,
  stuckAIRequestRows,
  recentAIFailureRows,
  tombstoneCount,
  now = new Date(),
}) {
  const cleanupCutoff = new Date(
    now.getTime() - CLEANUP_STALE_HOURS * HOUR_MS,
  );
  const staleCleanupCount = cleanupRows.filter(row =>
    timeIsAtOrBefore(row.updated_at, cleanupCutoff),
  ).length;
  const repeatedCleanupFailureCount = cleanupRows.filter(row =>
    row.status === 'failed' &&
    finiteInteger(row.attempt_count) >= REPEATED_CLEANUP_ATTEMPTS,
  ).length;
  const failedCleanupCount = cleanupRows.filter(
    row => row.status === 'failed',
  ).length;
  const pendingCleanupCount = cleanupRows.filter(
    row => row.status === 'pending',
  ).length;
  const stuckAIRequestCount = stuckAIRequestRows.length;
  const recentAIFailureCount = recentAIFailureRows.length;
  const critical = [];
  const warnings = [];

  if (staleCleanupCount > 0) {
    critical.push(
      `${staleCleanupCount} protected file cleanup request(s) have been waiting more than ${CLEANUP_STALE_HOURS} hours.`,
    );
  }
  if (repeatedCleanupFailureCount > 0) {
    critical.push(
      `${repeatedCleanupFailureCount} protected file cleanup request(s) failed at least ${REPEATED_CLEANUP_ATTEMPTS} times.`,
    );
  }
  if (stuckAIRequestCount > 0) {
    critical.push(
      `${stuckAIRequestCount} AI operation request(s) have been processing more than ${AI_STALE_MINUTES} minutes.`,
    );
  }
  if (expiredDeletionReceiptCount > 0) {
    warnings.push(
      `${expiredDeletionReceiptCount} metadata-only deletion receipt(s) are eligible for owner-authorized retention cleanup.`,
    );
  }
  if (recentAIFailureCount > 0) {
    warnings.push(
      `${recentAIFailureCount} AI operation failure(s) were recorded in the last 24 hours.`,
    );
  }

  return Object.freeze({
    ok: critical.length === 0,
    checkedAt: now.toISOString(),
    critical,
    warnings,
    metrics: Object.freeze({
      pendingCleanupCount,
      failedCleanupCount,
      staleCleanupCount,
      repeatedCleanupFailureCount,
      expiredDeletionReceiptCount: finiteInteger(
        expiredDeletionReceiptCount,
      ),
      stuckAIRequestCount,
      recentAIFailureCount,
      tombstoneCount: finiteInteger(tombstoneCount),
    }),
  });
}

async function readRows(query, label) {
  const { data, error } = await query;
  if (error) {
    throw new Error(`${label} could not be checked.`);
  }
  return Array.isArray(data) ? data : [];
}

async function countRows(query, label) {
  const { error, count } = await query;
  if (error) {
    throw new Error(`${label} could not be counted.`);
  }
  return finiteInteger(count);
}

async function collectProductionOperationsHealth(client, now = new Date()) {
  const aiCutoff = new Date(
    now.getTime() - AI_STALE_MINUTES * 60 * 1000,
  ).toISOString();
  const recentCutoff = new Date(now.getTime() - 24 * HOUR_MS).toISOString();

  const [
    cleanupRows,
    expiredDeletionReceiptCount,
    stuckAIRequestRows,
    recentAIFailureRows,
    tombstoneCount,
  ] = await Promise.all([
    readRows(
      client
        .from('dave_storage_cleanup_intents')
        .select('status,attempt_count,updated_at')
        .in('status', ['pending', 'failed'])
        .lte('updated_at', now.toISOString())
        .order('updated_at', { ascending: true })
        .limit(1000),
      'Protected file cleanup',
    ),
    countRows(
      client
        .from('dave_deletion_audit')
        .select('id', { count: 'exact', head: true })
        .lte('purge_after', now.toISOString()),
      'Deletion retention',
    ),
    readRows(
      client
        .from('dave_ai_operation_requests')
        .select('status,started_at')
        .eq('status', 'processing')
        .lte('started_at', aiCutoff)
        .limit(1000),
      'AI operation processing',
    ),
    readRows(
      client
        .from('dave_ai_operation_requests')
        .select('status,started_at')
        .eq('status', 'failed')
        .gte('started_at', recentCutoff)
        .limit(1000),
      'Recent AI operations',
    ),
    countRows(
      client
        .from('dave_sync_tombstones')
        .select('record_id', { count: 'exact', head: true }),
      'Permanent deletion markers',
    ),
  ]);

  return analyzeProductionOperationsHealth({
    cleanupRows,
    expiredDeletionReceiptCount,
    stuckAIRequestRows,
    recentAIFailureRows,
    tombstoneCount,
    now,
  });
}

function formatHealthSummary(result) {
  const status = result.ok ? 'PASS' : 'FAIL';
  const rows = [
    `# Vitruvius production operations health: ${status}`,
    '',
    `Checked: ${result.checkedAt}`,
    '',
    '| Check | Count |',
    '| --- | ---: |',
    `| Pending protected-file cleanup | ${result.metrics.pendingCleanupCount} |`,
    `| Failed protected-file cleanup | ${result.metrics.failedCleanupCount} |`,
    `| Cleanup waiting over ${CLEANUP_STALE_HOURS} hours | ${result.metrics.staleCleanupCount} |`,
    `| Cleanup failed ${REPEATED_CLEANUP_ATTEMPTS}+ times | ${result.metrics.repeatedCleanupFailureCount} |`,
    '| Expired deletion receipts | ' +
      `${result.metrics.expiredDeletionReceiptCount} |`,
    `| AI work stuck over ${AI_STALE_MINUTES} minutes | ${result.metrics.stuckAIRequestCount} |`,
    '| AI failures in the last 24 hours | ' +
      `${result.metrics.recentAIFailureCount} |`,
    `| Permanent deletion markers | ${result.metrics.tombstoneCount} |`,
  ];
  if (result.critical.length > 0) {
    rows.push('', '## Release-blocking findings');
    result.critical.forEach(value => rows.push(`- ${value}`));
  }
  if (result.warnings.length > 0) {
    rows.push('', '## Follow-up');
    result.warnings.forEach(value => rows.push(`- ${value}`));
  }
  return `${rows.join('\n')}\n`;
}

async function main() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the production health check.',
    );
  }
  const client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const result = await collectProductionOperationsHealth(client);
  const summary = formatHealthSummary(result);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    const message =
      error instanceof Error
        ? error.message
        : 'Production operations health check failed.';
    process.stderr.write(`Vitruvius production operations health FAIL: ${message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  analyzeProductionOperationsHealth,
  collectProductionOperationsHealth,
  formatHealthSummary,
};
