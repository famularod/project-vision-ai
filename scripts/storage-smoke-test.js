#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missingEnv = REQUIRED_ENV.filter(name => !process.env[name]);

if (missingEnv.length > 0) {
  console.log('EXTERNAL EXECUTION REQUIRED');
  console.log(`Missing environment variables: ${missingEnv.join(', ')}`);
  console.log(
    'Required command: SUPABASE_URL=<url> SUPABASE_ANON_KEY=<anon-key> npm run dev:storage-smoke-test -- --email <email> --password <password> --project-name "Canopy C"',
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const email = String(args.email || '').trim();
const password = String(args.password || '').trim();
const projectName = String(args['project-name'] || 'Canopy C').trim();
const bucket = 'project-photos';
const runId = `storage-smoke-${Date.now()}`;

if (!email) fail('Missing required --email.');
if (!password) fail('Missing required --password.');

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

main().catch(error => fail(error instanceof Error ? error.message : String(error)));

async function main() {
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`Sign-in failed: ${safeError(signIn.error)}`);

  const tokenPresent = Boolean(signIn.data.session?.access_token);
  const userPresent = Boolean(signIn.data.user?.id);
  const project = await findProject(projectName);
  const path = buildSmokePath(projectName, runId);
  const bytes = new TextEncoder().encode('Project Vision AI storage smoke test');

  const upload = await client.storage.from(bucket).upload(path, bytes, {
    contentType: 'text/plain',
    upsert: true,
    cacheControl: '60',
  });

  const status = statusFromError(upload.error);
  const code = codeFromError(upload.error);
  const category = upload.error
    ? classifyStorageFailure(upload.error.message, status, code)
    : 'none';

  console.log('Storage smoke test result');
  console.log(`token present: ${tokenPresent ? 'yes' : 'no'}`);
  console.log(`user id present: ${userPresent ? 'yes' : 'no'}`);
  console.log(`project visible: ${project.visible ? 'yes' : 'no'}`);
  console.log(`project organization visible: ${project.organizationIdPresent ? 'yes' : 'no'}`);
  console.log(`bucket: ${bucket}`);
  console.log('object path category: project/update/photo-file');
  console.log(`upload allowed: ${upload.error ? 'no' : 'yes'}`);
  console.log(`status: ${status ?? 'none'}`);
  console.log(`code: ${code || 'none'}`);
  console.log(`category: ${category}`);

  if (!upload.error) {
    const remove = await client.storage.from(bucket).remove([path]);
    console.log(`cleanup: ${remove.error ? 'failed' : 'success'}`);
    if (remove.error) console.log(`cleanup category: ${classifyStorageFailure(remove.error.message, statusFromError(remove.error), codeFromError(remove.error))}`);
  }
}

async function findProject(name) {
  const result = await client
    .from('projects')
    .select('name, organization_id')
    .eq('name', name)
    .maybeSingle();

  if (result.error) {
    return {
      visible: false,
      organizationIdPresent: false,
    };
  }

  return {
    visible: Boolean(result.data),
    organizationIdPresent: Boolean(result.data?.organization_id),
  };
}

function buildSmokePath(projectName, updateId) {
  return [
    sanitizePathSegment(projectName || 'unassigned-project'),
    sanitizePathSegment(updateId),
    `${sanitizePathSegment(`photo-${updateId}`)}-smoke.txt`,
  ].join('/');
}

function sanitizePathSegment(value) {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

function statusFromError(error) {
  if (!error) return null;
  if (typeof error.statusCode === 'number') return error.statusCode;
  if (typeof error.status === 'number') return error.status;
  return null;
}

function codeFromError(error) {
  if (!error) return null;
  if (typeof error.error === 'string') return error.error;
  if (typeof error.code === 'string') return error.code;
  return null;
}

function classifyStorageFailure(message, status, code) {
  const combined = `${message || ''} ${code || ''}`.toLowerCase();
  if (/bucket.*not.*found|bucket.*missing|not_found|no such bucket/.test(combined)) return 'bucket_missing';
  if (/row level|rls|policy|permission denied|violates row-level|42501/.test(combined)) return 'rls_denied';
  if (status === 401 || /jwt|token|unauthorized|auth|session/.test(combined)) return 'auth_missing';
  if (status === 403 || /forbidden/.test(combined)) return 'rls_denied';
  if (/invalid.*path|object.*name|path|undefined|null/.test(combined)) return 'invalid_path';
  if (/payload|body|arraybuffer|blob|base64|invalid.*upload/.test(combined)) return 'invalid_payload';
  if (/content.?type|mime|unsupported/.test(combined)) return 'unsupported_content_type';
  if (/offline|network|connection|fetch|timeout|unreachable|internet/.test(combined)) return 'network';
  return 'unknown_storage_error';
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

function safeError(error) {
  return String(error.message || error)
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/g, '[redacted-jwt]');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
