const { createClient } = require('@supabase/supabase-js');

const required = name => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const boundedInteger = (name, fallback, minimum, maximum) => {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
};

async function main() {
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const maximumQueueAgeSeconds = boundedInteger('ECOS_HEALTH_MAX_QUEUE_AGE_SECONDS', 7200, 300, 604800);
  const maximumHeartbeatAgeSeconds = boundedInteger('ECOS_HEALTH_MAX_HEARTBEAT_AGE_SECONDS', 900, 300, 86400);

  const [healthResult, activeResult] = await Promise.all([
    client.rpc('ecos_hosted_index_operations_health'),
    client.from('ecos_hosted_index_jobs')
      .select('id,state,heartbeat_at,updated_at')
      .in('state', ['fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring']),
  ]);
  if (healthResult.error) throw healthResult.error;
  if (activeResult.error) throw activeResult.error;

  const health = healthResult.data?.[0] || {};
  const now = Date.now();
  const staleActiveJobs = activeResult.data.filter(job => {
    const heartbeat = Date.parse(job.heartbeat_at || job.updated_at || '');
    return Number.isFinite(heartbeat) && (now - heartbeat) / 1000 > maximumHeartbeatAgeSeconds;
  }).length;
  const report = {
    checkedAt: new Date(now).toISOString(),
    queuedJobs: Number(health.queued_jobs || 0),
    activeJobs: Number(health.active_jobs || 0),
    blockedJobs: Number(health.blocked_jobs || 0),
    staleActiveJobs,
    oldestQueuedSeconds: Number(health.oldest_queued_seconds || 0),
    pagesAssuredLast24h: Number(health.pages_assured_last_24h || 0),
    visualRegionsLast24h: Number(health.visual_regions_last_24h || 0),
    estimatedVisualCostMicrousdLast24h: Number(health.estimated_visual_cost_microusd_last_24h || 0),
  };
  console.log(JSON.stringify(report, null, 2));

  const failures = [];
  if (report.blockedJobs > 0) failures.push(`${report.blockedJobs} hosted index jobs require review`);
  if (report.staleActiveJobs > 0) failures.push(`${report.staleActiveJobs} active jobs have stale heartbeats`);
  if (report.oldestQueuedSeconds > maximumQueueAgeSeconds) {
    failures.push(`oldest queued work exceeds ${maximumQueueAgeSeconds} seconds`);
  }
  if (failures.length > 0) throw new Error(failures.join('; '));
  console.log('ECOS hosted indexer operations health: PASS');
}

main().catch(error => {
  console.error(`ECOS hosted indexer operations health: FAIL - ${error.message}`);
  process.exit(1);
});
