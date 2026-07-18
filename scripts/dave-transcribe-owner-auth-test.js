#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/dave-transcribe-memory/index.ts'),
  'utf8',
);

const authCheck = source.indexOf('await supabase.auth.getUser()');
const ownerCheck = source.indexOf("await supabase.rpc('dave_is_app_owner')");
const formRead = source.indexOf('await request.formData()');

assert(authCheck >= 0, 'voice capture must validate the Supabase session');
assert(ownerCheck > authCheck, 'voice capture must check app ownership after authentication');
assert(formRead > ownerCheck, 'voice audio must not be read before ownership is confirmed');
assert(source.includes("return json({ error: 'forbidden' }, 403)"), 'non-owner access must be forbidden');
assert(source.includes("return json({ error: 'authorization_unavailable' }, 503)"), 'owner-check failures must fail closed');

console.log('DAVE voice-memory owner authorization checks passed.');
