import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
if (!projectRef) {
  throw new Error('SUPABASE_PROJECT_REF is required');
}

const cwd = process.cwd();
const apiUrl = `https://${projectRef}.supabase.co`;
const suffix = randomUUID();
const email = `ecos-race-${suffix}@example.invalid`;
const password = `Ec0s!${randomUUID()}Aa9`;
const organizationId = `__ecos-race-${suffix}`;
const projectId = randomUUID();
const familyId = `__ecos-race-family-${suffix}`;
const oldId = `__ecos-race-old-${suffix}`;
const targetAId = `__ecos-race-a-${suffix}`;
const targetBId = `__ecos-race-b-${suffix}`;
const expectedUpdatedAt = new Date(Date.now() - 60_000).toISOString();

let userId = null;
let serviceKey = null;

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function dbQuery(sql) {
  let raw;
  try {
    raw = execFileSync(
      'npx',
      ['supabase', 'db', 'query', '--linked', sql],
      { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    const stderr = String(error?.stderr ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && line !== 'Initialising login role...')
      .slice(-2)
      .join(' ');
    throw new Error(stderr || 'Supabase database query failed');
  }

  const start = raw.indexOf('{');
  if (start < 0) {
    throw new Error('Supabase query returned no JSON payload');
  }
  return JSON.parse(raw.slice(start));
}

async function api(path, init = {}) {
  const response = await fetch(apiUrl + path, init);
  const bodyText = await response.text();
  let body = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }
  return { response, body };
}

function loadProjectApiKeys() {
  const raw = execFileSync(
    'npx',
    [
      'supabase',
      'projects',
      'api-keys',
      '--project-ref',
      projectRef,
      '--output',
      'json',
    ],
    { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  const keys = JSON.parse(raw);
  return {
    anonKey: keys.find(
      (key) => key.name === 'anon' && key.type === 'legacy',
    )?.api_key,
    serviceKey: keys.find(
      (key) => key.name === 'service_role' && key.type === 'legacy',
    )?.api_key,
  };
}

async function main() {
  const projectKeys = loadProjectApiKeys();
  const anonKey = projectKeys.anonKey;
  serviceKey = projectKeys.serviceKey;
  if (!anonKey || !serviceKey) {
    throw new Error('Required project API keys were unavailable');
  }

  const create = await api('/auth/v1/admin/users', {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!create.response.ok || !create.body?.id) {
    throw new Error(
      `Synthetic user creation failed with HTTP ${create.response.status}`,
    );
  }
  userId = create.body.id;

  const shaOld = '1'.repeat(64);
  const shaA = '2'.repeat(64);
  const shaB = '3'.repeat(64);
  const baseData = {
    category: 'Drawing',
    projectId,
    projectName: `ECOS race ${suffix}`,
    projectNames: [projectId, `ECOS race ${suffix}`],
    organizationId,
    webVersionGroupId: familyId,
    drawingNumber: 'RACE-901',
    drawingStatus: 'Issued',
    sourcePageCount: '1',
  };
  const docData = (revision, sha, storagePath, isCurrent) =>
    JSON.stringify({
      ...baseData,
      drawingRevision: revision,
      contentSha256: sha,
      storagePath,
      isCurrent,
    });

  dbQuery(`
    insert into public.organizations (id, name)
    values (
      ${sqlText(organizationId)},
      ${sqlText(`ECOS activation race ${suffix}`)}
    );

    insert into public.organization_memberships (
      user_id, organization_id, status, role
    ) values (
      ${sqlText(userId)}::uuid,
      ${sqlText(organizationId)},
      'active',
      'organization_admin'
    );

    insert into public.projects (id, name, status, archived, owner_id)
    values (
      ${sqlText(projectId)}::uuid,
      ${sqlText(`ECOS activation race ${suffix}`)},
      'Active',
      false,
      ${sqlText(userId)}::uuid
    );

    insert into public.ecos_hosted_index_configuration (
      organization_id, publication_mode, enabled, updated_by, updated_at
    ) values (
      ${sqlText(organizationId)},
      'live',
      true,
      ${sqlText(userId)}::uuid,
      now()
    );

    insert into public.reference_documents (
      id, name, category, document_data, owner_id, created_at, updated_at
    ) values
    (
      ${sqlText(oldId)},
      'ECOS race old',
      'Drawing',
      ${sqlText(docData(
        'R1',
        shaOld,
        `__ecos-tests__/${oldId}.pdf`,
        false,
      ))}::jsonb,
      ${sqlText(userId)}::uuid,
      ${sqlText(expectedUpdatedAt)}::timestamptz,
      ${sqlText(expectedUpdatedAt)}::timestamptz
    ),
    (
      ${sqlText(targetAId)},
      'ECOS race target A',
      'Drawing',
      ${sqlText(docData(
        'R2',
        shaA,
        `__ecos-tests__/${targetAId}.pdf`,
        false,
      ))}::jsonb,
      ${sqlText(userId)}::uuid,
      ${sqlText(expectedUpdatedAt)}::timestamptz,
      ${sqlText(expectedUpdatedAt)}::timestamptz
    ),
    (
      ${sqlText(targetBId)},
      'ECOS race target B',
      'Drawing',
      ${sqlText(docData(
        'R3',
        shaB,
        `__ecos-tests__/${targetBId}.pdf`,
        false,
      ))}::jsonb,
      ${sqlText(userId)}::uuid,
      ${sqlText(expectedUpdatedAt)}::timestamptz,
      ${sqlText(expectedUpdatedAt)}::timestamptz
    );

    select set_config('app.ecos_current_activation', 'allowed', true);
    update public.reference_documents
    set document_data = jsonb_set(
      document_data,
      '{isCurrent}',
      'true'::jsonb,
      true
    )
    where id = ${sqlText(oldId)}
      and owner_id = ${sqlText(userId)}::uuid;
    select set_config('app.ecos_current_activation', '', true);

    update public.ecos_hosted_index_jobs
    set source_scan_status = 'clean',
        source_scan_engine = 'deterministic-live-race',
        source_scan_at = clock_timestamp(),
        state = 'ready',
        completed_page_count = 1,
        assured_page_count = 1,
        unresolved_region_count = 0,
        committed_evidence_version = 'ecos-hosted-evidence/1.3',
        ready_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where document_id in (${sqlText(targetAId)}, ${sqlText(targetBId)})
      and source_owner_id = ${sqlText(userId)}::uuid
      and mode = 'shadow';
  `);

  const token = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!token.response.ok || !token.body?.access_token) {
    throw new Error(`Synthetic sign-in failed with HTTP ${token.response.status}`);
  }

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token.body.access_token}`,
    'Content-Type': 'application/json',
  };
  const activate = (documentId) =>
    api('/rest/v1/rpc/ecos_activate_current_reference_document', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_document_id: documentId,
        p_expected_updated_at: expectedUpdatedAt,
      }),
    });

  const startedAt = Date.now();
  const [activationA, activationB] = await Promise.all([
    activate(targetAId),
    activate(targetBId),
  ]);
  const elapsedMs = Date.now() - startedAt;
  if (!activationA.response.ok || !activationB.response.ok) {
    throw new Error(
      `Concurrent RPC failed: A=${activationA.response.status}, B=${activationB.response.status}`,
    );
  }

  const verification = dbQuery(`
    select
      count(*) filter (
        where document_data->>'isCurrent' = 'true'
      )::int as current_count,
      count(*) filter (
        where id in (${sqlText(targetAId)}, ${sqlText(targetBId)})
          and document_data->>'isCurrent' = 'true'
      )::int as target_current_count,
      count(*) filter (
        where id = ${sqlText(oldId)}
          and document_data->>'isCurrent' = 'true'
      )::int as old_current_count
    from public.reference_documents
    where owner_id = ${sqlText(userId)}::uuid
      and id in (
        ${sqlText(oldId)},
        ${sqlText(targetAId)},
        ${sqlText(targetBId)}
      );
  `);
  const row = verification.rows?.[0];
  if (
    !row ||
    row.current_count !== 1 ||
    row.target_current_count !== 1 ||
    row.old_current_count !== 0
  ) {
    throw new Error(
      `Concurrent activation violated atomic current invariant: ${JSON.stringify(row)}`,
    );
  }

  console.log(
    JSON.stringify({
      status: 'PASS',
      test: 'live_two_request_competing_activation',
      concurrentHttpStatuses: [
        activationA.response.status,
        activationB.response.status,
      ],
      elapsedMs,
      exactCurrentCount: row.current_count,
      customerRowsTouched: 0,
    }),
  );
}

async function cleanup() {
  if (!userId) {
    return;
  }

  dbQuery(`
    delete from public.ecos_hosted_index_pages
    where job_id in (
      select id
      from public.ecos_hosted_index_jobs
      where organization_id = ${sqlText(organizationId)}
         or source_owner_id = ${sqlText(userId)}::uuid
    );
    delete from public.ecos_hosted_index_jobs
    where organization_id = ${sqlText(organizationId)}
       or source_owner_id = ${sqlText(userId)}::uuid;
    delete from public.reference_documents
    where owner_id = ${sqlText(userId)}::uuid
       or id in (
         ${sqlText(oldId)},
         ${sqlText(targetAId)},
         ${sqlText(targetBId)}
       );
    delete from public.dave_storage_cleanup_intents
    where owner_id = ${sqlText(userId)}::uuid;
    delete from public.ecos_hosted_index_configuration
    where organization_id = ${sqlText(organizationId)};
    delete from public.projects
    where id = ${sqlText(projectId)}::uuid
       or owner_id = ${sqlText(userId)}::uuid;
    delete from public.organization_memberships
    where organization_id = ${sqlText(organizationId)}
       or user_id = ${sqlText(userId)}::uuid;
    delete from public.organizations
    where id = ${sqlText(organizationId)};
  `);

  if (!serviceKey) {
    serviceKey = loadProjectApiKeys().serviceKey;
  }
  if (!serviceKey) {
    throw new Error('Service key unavailable during synthetic-user cleanup');
  }
  const deletion = await api(`/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!deletion.response.ok && deletion.response.status !== 404) {
    dbQuery(`
      delete from auth.users
      where id = ${sqlText(userId)}::uuid
        and email like 'ecos-race-%@example.invalid';
    `);
  }

  const verification = dbQuery(`
    select
      (select count(*) from public.organizations
        where id = ${sqlText(organizationId)})::int as organizations,
      (select count(*) from public.organization_memberships
        where organization_id = ${sqlText(organizationId)})::int as memberships,
      (select count(*) from public.reference_documents
        where owner_id = ${sqlText(userId)}::uuid)::int as documents,
      (select count(*) from public.ecos_hosted_index_jobs
        where organization_id = ${sqlText(organizationId)})::int as jobs,
      (select count(*) from public.dave_storage_cleanup_intents
        where owner_id = ${sqlText(userId)}::uuid)::int as cleanup_intents,
      (select count(*) from auth.users
        where id = ${sqlText(userId)}::uuid)::int as users;
  `);
  const row = verification.rows?.[0];
  if (!row || Object.values(row).some((count) => count !== 0)) {
    throw new Error(
      `Synthetic fixture cleanup was incomplete: ${JSON.stringify(row)}`,
    );
  }
  console.log(JSON.stringify({ cleanup: 'PASS', remainingFixtureRows: 0 }));
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  exitCode = 1;
  console.error(JSON.stringify({ status: 'FAIL', message: error.message }));
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    exitCode = 2;
    console.error(
      JSON.stringify({ status: 'CLEANUP_FAIL', message: cleanupError.message }),
    );
  }
}

process.exitCode = exitCode;
