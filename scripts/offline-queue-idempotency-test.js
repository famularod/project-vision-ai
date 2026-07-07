#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('App.tsx');
const sync = read('services/SyncService.ts');
const supabase = read('services/SupabaseService.ts');
const migration = read('supabase/migrations/20260706010000_project_update_idempotency_key.sql');

assert(
  app.includes('const idempotencyKey = draft.idempotencyKey || draft.stableSendId || `send-${draft.id}`') &&
    app.includes('stableSendId: idempotencyKey') &&
    app.includes('idempotencyKey,'),
  'Initial send must create one stable idempotency key from the draft id.',
);

assert(
  app.includes('stableSendId: update.idempotencyKey || update.stableSendId || `send-${update.id}`') &&
    app.includes('idempotencyKey: update.idempotencyKey || update.stableSendId || `send-${update.id}`'),
  'Retry must reuse the existing update idempotency key instead of regenerating one.',
);

assert(
  sync.includes("id: `project-update-${update.id}`") &&
    sync.includes('...queue.filter(item => item.id !== queueItem.id)') &&
    sync.includes('projectUpdateIdempotencyKey(payload.updateData, payload.id)'),
  'Offline queue must use a stable queue item id and pass a stable idempotency key to the cloud write.',
);

assert(
  supabase.includes('idempotencyKey?: string | null') &&
    supabase.includes('idempotency_key: stableIdempotencyKey') &&
    supabase.includes(".upsert(payload, { onConflict: 'id' })") &&
    supabase.includes('extractProjectUpdateIdempotencyKey(updateData)') &&
    supabase.includes('sanitizeIdempotencyKey(update.idempotencyKey)') &&
    supabase.includes('sanitizeIdempotencyKey(update.stableSendId)'),
  'Supabase project update upsert must persist the stable idempotency key while keeping id-based upsert behavior.',
);

assert(
  migration.includes('add column if not exists idempotency_key text') &&
    migration.includes('create unique index if not exists project_updates_idempotency_key_unique') &&
    migration.includes('where idempotency_key is not null') &&
    migration.includes("update_data ->> 'idempotencyKey'") &&
    migration.includes("update_data ->> 'stableSendId'"),
  'Migration must add and backfill a database-level unique idempotency key constraint.',
);

assert(
  !sync.includes('service_role') &&
    !supabase.includes('SUPABASE_SERVICE_ROLE_KEY') &&
    !sync.includes('functions.invoke') &&
    !supabase.includes("functions.invoke('"),
  'Offline queued send idempotency must not introduce service-role or Edge Function dependencies.',
);

console.log('Offline queue idempotency tests passed.');
