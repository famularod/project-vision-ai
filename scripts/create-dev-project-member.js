#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnv = REQUIRED_ENV.filter(name => !process.env[name]);

if (missingEnv.length > 0) {
  console.log('EXTERNAL EXECUTION REQUIRED');
  console.log(`Missing environment variables: ${missingEnv.join(', ')}`);
  console.log(
    'Required command: SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<service-role-key> node scripts/create-dev-project-member.js --email <user-email> --project-name <project-name>',
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const email = String(args.email || '').trim().toLowerCase();
const organizationIdInput = String(args['organization-id'] || '').trim();
const projectName = String(args['project-name'] || '').trim();
const areaName = String(args['area-name'] || '').trim();
const role = String(args.role || 'project_manager').trim();

if (!email) fail('Missing required --email <user-email>.');
if (!['project_manager', 'decision_owner', 'validation_authority', 'organization_admin'].includes(role)) {
  fail('Role must be project_manager, decision_owner, validation_authority, or organization_admin.');
}

const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

main().catch(error => {
  fail(error instanceof Error ? error.message : String(error));
});

async function main() {
  const user = await findAuthUserByEmail(email);
  let organizationId = organizationIdInput;
  let matched = null;

  if (!organizationId && projectName) {
    matched = await findOrganizationForProjectName(projectName);
    organizationId = matched.organizationId;
  }

  if (!organizationId && areaName) {
    matched = await findOrganizationForAreaName(areaName);
    organizationId = matched.organizationId;
  }

  if (!organizationId) {
    fail(
      'Missing organization id. Pass --organization-id, or pass --project-name/--area-name for a row that contains organizationId in project_data/area_data.',
    );
  }

  await upsertOrganization(organizationId);
  await upsertMembership(user.id, organizationId, role);

  console.log('Dev project membership ready.');
  console.log(`Email: ${email}`);
  console.log(`Organization: ${organizationId}`);
  console.log(`Role: ${role}`);
  if (matched) {
    console.log(`Matched ${matched.source}: ${matched.name}`);
    console.log(`Matched row id: ${matched.id}`);
  } else if (projectName) {
    console.log(`Project lookup: ${projectName}`);
  } else if (areaName) {
    console.log(`Area lookup: ${areaName}`);
  }
}

async function findAuthUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 100;

  while (page < 100) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) throw new Error(`Auth user lookup failed: ${safeError(error)}`);

    const user = data.users.find(item => item.email?.toLowerCase() === targetEmail);
    if (user) return user;
    if (data.users.length < perPage) break;
    page += 1;
  }

  throw new Error(`No Supabase Auth user found for ${targetEmail}. Sign in or sign up in the app first.`);
}

async function findOrganizationForProjectName(name) {
  const { data, error } = await service
    .from('projects')
    .select('id, name, owner_id, project_data')
    .eq('name', name)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Project organization lookup failed. Pass --organization-id explicitly. Detail: ${safeError(error)}`,
    );
  }

  if (!data) {
    throw new Error(`No project row found for "${name}".`);
  }

  const organizationId = organizationIdFromRecord(data.project_data);

  if (!organizationId) {
    throw new Error(
      `Project "${name}" does not expose organizationId in project_data. Pass --organization-id explicitly.`,
    );
  }

  return {
    source: 'project',
    id: data.id,
    name: data.name,
    organizationId,
  };
}

async function findOrganizationForAreaName(name) {
  const { data, error } = await service
    .from('project_areas')
    .select('id, name, area_data')
    .eq('name', name)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Area organization lookup failed. Pass --organization-id explicitly. Detail: ${safeError(error)}`,
    );
  }

  if (!data) {
    throw new Error(`No project area row found for "${name}".`);
  }

  const organizationId = organizationIdFromRecord(data.area_data);

  if (!organizationId) {
    throw new Error(
      `Area "${name}" does not expose organizationId in area_data. Pass --organization-id explicitly.`,
    );
  }

  return {
    source: 'area',
    id: data.id,
    name: data.name,
    organizationId,
  };
}

async function upsertOrganization(organizationId) {
  const { error } = await service
    .from('organizations')
    .upsert({
      id: organizationId,
      name: organizationId,
      updated_at: new Date().toISOString(),
    });

  if (error) throw new Error(`Organization setup failed: ${safeError(error)}`);
}

async function upsertMembership(userId, organizationId, role) {
  const { error } = await service
    .from('organization_memberships')
    .upsert(
      {
        user_id: userId,
        organization_id: organizationId,
        status: 'active',
        role,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,organization_id' },
    );

  if (error) throw new Error(`Membership setup failed: ${safeError(error)}`);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? next : 'true';
    if (next && !next.startsWith('--')) index += 1;
  }

  return parsed;
}

function organizationIdFromRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

  const candidates = [
    value.organizationId,
    value.organization_id,
    value.orgId,
    value.org_id,
    value.teamId,
    value.team_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  return '';
}

function safeError(error) {
  return String(error.message || error)
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/g, '[redacted-jwt]')
    .replace(/service_role[^\s]*/gi, 'service_role[redacted]');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
