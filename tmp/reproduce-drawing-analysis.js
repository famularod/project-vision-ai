const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createClient } = require('../node_modules/@supabase/supabase-js');

const projectRef = 'xdytqlpsqsseoeuxgzre';
const supabaseUrl = `https://${projectRef}.supabase.co`;
const keys = JSON.parse(execFileSync('npx', [
  '--yes', 'supabase@2.75.0', 'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
], { cwd: __dirname + '/..', encoding: 'utf8' }));
const serviceKey = keys.find(key => key.name === 'service_role')?.api_key;
const anonKey = keys.find(key => key.name === 'anon')?.api_key;
if (!serviceKey || !anonKey) throw new Error('Supabase credentials are unavailable.');

(async () => {
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const source = await admin.from('reference_documents')
    .select('owner_id')
    .eq('id', 'web-document-09314ce4-aff1-4857-9cc9-5f13ecae4603')
    .single();
  if (source.error) throw source.error;
  const user = await admin.auth.admin.getUserById(source.data.owner_id);
  if (user.error || !user.data.user.email) throw new Error('Owner session unavailable.');
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.data.user.email });
  if (link.error || !link.data.properties.hashed_token) throw new Error('Owner verification unavailable.');
  const ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await ownerClient.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
  const accessToken = verified.data.session?.access_token;
  if (verified.error || !accessToken) throw new Error('Owner verification failed.');

  const image = fs.readFileSync(__dirname + '/pdfs/architectural-page-13/overview.jpg').toString('base64');
  const tileBounds = [
    { x: 0, y: 0, width: 1 / 3, height: 0.5 },
    { x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 },
    { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 },
    { x: 0, y: 0.5, width: 1 / 3, height: 0.5 },
    { x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
    { x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
  ];
  const tileImages = tileBounds.map((bounds, index) => ({
    bounds,
    imageDataUrl: `data:image/jpeg;base64,${fs.readFileSync(`${__dirname}/pdfs/architectural-page-13/tile-${index}.jpg`).toString('base64')}`,
  }));
  const startedAt = Date.now();
  const response = await fetch(`${supabaseUrl}/functions/v1/ecos-analyze-drawing-page`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      schemaVersion: 'ecos-drawing-page-analysis/2.0',
      pageNumber: 13,
      documentName: '01 - PLZ CORP - 2375 THIRD STREET - ARCHITECTURAL',
      discipline: 'architectural',
      existingText: '',
      imageDataUrl: `data:image/jpeg;base64,${image}`,
      analysisPass: 'page_tiles',
      tileBounds: null,
      tileImages,
    }),
  });
  const body = await response.json().catch(() => null);
  console.log(JSON.stringify({
    status: response.status,
    durationSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    body,
  }, null, 2));
})().catch(error => {
  console.error(JSON.stringify({
    message: error?.message || null,
    code: error?.code || null,
    details: error?.details || null,
  }));
  process.exitCode = 1;
});
