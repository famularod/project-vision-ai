#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const forbiddenPublicOpenAI = [
  ['EXPO_PUBLIC', 'OPENAI_API_KEY'],
  ['EXPO_PUBLIC', 'AI_PROVIDER'],
  ['EXPO_PUBLIC', 'OPENAI_MODEL'],
].map(parts => parts.join('_'));
const forbiddenPublicServiceRole = /^EXPO_PUBLIC_.*SERVICE_ROLE/i;
const openAISecretPattern = /\bsk-(?:proj-|[A-Za-z0-9])[A-Za-z0-9_-]{20,}\b/;
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

const clientRoots = [
  'App.tsx',
  'app.json',
  'eas.json',
  '.env',
  '.env.local',
  '.env.production',
  '.env.example',
  'components',
  'config',
  'lib',
  'screens',
  'services',
  'types',
  'utils',
];

const skipFiles = new Set([
  path.join(rootDir, 'scripts', 'production-secret-guard.js'),
  path.join(rootDir, 'app.config.js'),
]);

function shouldRead(filePath) {
  if (skipFiles.has(filePath)) return false;
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return false;
  if (stat.size > 2_000_000) return false;
  return /\.(?:ts|tsx|js|jsx|json|env|example|mjs|cjs)$/.test(filePath) ||
    path.basename(filePath).startsWith('.env');
}

function walk(entry) {
  const absolute = path.join(rootDir, entry);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return shouldRead(absolute) ? [absolute] : [];
  if (!stat.isDirectory()) return [];

  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(child => {
    if (child.name === 'node_modules' || child.name.startsWith('.')) return [];
    return walk(path.join(entry, child.name));
  });
}

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function relative(filePath) {
  return path.relative(rootDir, filePath) || filePath;
}

const failures = [];

for (const name of Object.keys(process.env)) {
  if (forbiddenPublicOpenAI.includes(name)) {
    failures.push(`environment contains forbidden public OpenAI variable ${name}`);
  }
  if (forbiddenPublicServiceRole.test(name)) {
    failures.push(`environment contains forbidden public service-role variable ${name}`);
  }
}

const files = Array.from(new Set(clientRoots.flatMap(walk)));

for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf8');
  const file = relative(filePath);

  for (const name of forbiddenPublicOpenAI) {
    if (source.includes(name)) {
      failures.push(`${file} references forbidden public OpenAI variable ${name}`);
    }
  }

  const publicServiceRoleMatch = source.match(/EXPO_PUBLIC_[A-Z0-9_]*SERVICE_ROLE[A-Z0-9_]*/i);
  if (publicServiceRoleMatch) {
    failures.push(`${file} references forbidden public service-role variable ${publicServiceRoleMatch[0]}`);
  }

  if (openAISecretPattern.test(source)) {
    failures.push(`${file} contains an OpenAI secret-shaped value`);
  }

  for (const match of source.matchAll(jwtPattern)) {
    const payload = decodeJwtPayload(match[0]);
    if (payload?.role === 'service_role') {
      failures.push(`${file} contains a Supabase service-role JWT-shaped value`);
    }
  }
}

if (failures.length > 0) {
  console.error('Production secret guard failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Production secret guard passed.');
