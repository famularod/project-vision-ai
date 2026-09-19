const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createCanvas, loadImage } = require('../node_modules/@napi-rs/canvas');
const { createClient } = require('../node_modules/@supabase/supabase-js');

const projectRef = 'xdytqlpsqsseoeuxgzre';
const supabaseUrl = `https://${projectRef}.supabase.co`;
const projectName = '2375 Compliance Project';
const sourceDirectories = [
  '/Users/davidfamularo/Downloads',
  '/Users/davidfamularo/Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved/2375 Approved',
];
const pdfInfo = '/Users/davidfamularo/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdfinfo';
const pdfToPpm = '/Users/davidfamularo/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm';
const requestedPattern = process.argv.slice(2).join(' ').trim();
const primaryAnalysisAttempts = Math.max(1, Math.min(2, Number(process.env.ECOS_PRIMARY_ANALYSIS_ATTEMPTS) || 2));
const tileBounds = [
  { x: 0, y: 0, width: 1 / 3, height: 0.5 },
  { x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 },
  { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 },
  { x: 0, y: 0.5, width: 1 / 3, height: 0.5 },
  { x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
  { x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
];
const tileKeys = tileBounds.map(bounds => [bounds.x, bounds.y, bounds.width, bounds.height]
  .map(value => Math.round(value * 1_000)).join(':'));

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function dataUrl(buffer) {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function pageCount(filePath) {
  const output = execFileSync(pdfInfo, [filePath], { encoding: 'utf8' });
  const count = Number(output.match(/^Pages:\s+(\d+)/m)?.[1]);
  if (!Number.isInteger(count) || count < 1) throw new Error(`Could not read the PDF page count for ${path.basename(filePath)}.`);
  return count;
}

function projectNames(data) {
  return [data?.projectName, ...(Array.isArray(data?.projectNames) ? data.projectNames : [])].filter(Boolean);
}

function hasCompleteCoverage(page) {
  const coverage = page?.visualCoverage;
  return coverage?.overviewAnalyzed === true &&
    coverage.coverageComplete === true &&
    Number(coverage.completedDeepReadRegionCount) >= 6 &&
    tileKeys.every(key => (coverage.completedDeepReadRegionKeys || []).includes(key));
}

function buildRegion(pageNumber, fact, index, kind = 'drawing_fact') {
  const statement = String(fact.statement || '').trim();
  const evidenceText = String(fact.evidenceText || '').trim();
  const subject = String(fact.subject || '').trim();
  const location = String(fact.location || '').trim();
  const bounds = fact.bounds || {};
  if (!statement || !evidenceText) return null;
  const x = Number(bounds.x) / 1_000;
  const y = Number(bounds.y) / 1_000;
  const width = Number(bounds.width) / 1_000;
  const height = Number(bounds.height) / 1_000;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    id: `page-${pageNumber}-vision-batch-${kind}-${index + 1}`,
    label: statement,
    text: [
      'ECOS VISUAL DRAWING FACT',
      subject ? `Subject: ${subject}` : '',
      location ? `Location: ${location}` : '',
      `Fact: ${statement}`,
      `Visible evidence: ${evidenceText}`,
    ].filter(Boolean).join('. '),
    factKind: kind,
    subject: subject || null,
    location: location || null,
    evidenceText,
    areaNames: location ? [location] : [],
    x, y, width, height,
    confidence: Number(fact.confidence),
    source: 'vision',
  };
}

async function renderPageBatch(filePath, pageNumber, directory) {
  const prefix = path.join(directory, `page-${pageNumber}`);
  execFileSync(pdfToPpm, [
    '-f', String(pageNumber), '-l', String(pageNumber), '-singlefile',
    '-jpeg', '-jpegopt', 'quality=82', '-scale-to-x', '9000', '-scale-to-y', '-1',
    filePath, prefix,
  ], {
    // Some consultant PDFs emit hundreds of thousands of harmless Type 3
    // glyph warnings. Capturing that stderr can exhaust Node's child-process
    // buffer even though the page raster was created successfully.
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const renderedPath = `${prefix}.jpg`;
  const source = await loadImage(renderedPath);
  const overviewWidth = 2_400;
  const overviewHeight = Math.max(1, Math.round(source.height * (overviewWidth / source.width)));
  const overviewCanvas = createCanvas(overviewWidth, overviewHeight);
  overviewCanvas.getContext('2d').drawImage(source, 0, 0, overviewWidth, overviewHeight);
  const tileCanvases = [];
  for (const bounds of tileBounds) {
    const left = Math.round(source.width * bounds.x);
    const top = Math.round(source.height * bounds.y);
    const width = Math.round(source.width * bounds.width);
    const height = Math.round(source.height * bounds.height);
    const canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(source, left, top, width, height, 0, 0, width, height);
    tileCanvases.push(canvas);
  }
  fs.rmSync(renderedPath, { force: true });
  for (const quality of [82, 74, 66, 58, 50]) {
    const overview = await overviewCanvas.encode('jpeg', quality);
    const tiles = [];
    for (const canvas of tileCanvases) tiles.push(await canvas.encode('jpeg', quality));
    const totalDataUrlCharacters = [overview, ...tiles].reduce(
      (sum, image) => sum + 24 + (Math.ceil(image.length / 3) * 4),
      0,
    );
    if (totalDataUrlCharacters <= 17_800_000) {
      return {
        overview: dataUrl(overview),
        tiles: tiles.map((tile, index) => ({ bounds: tileBounds[index], imageDataUrl: dataUrl(tile) })),
      };
    }
  }
  throw new Error(`Page ${pageNumber} visual batch could not fit the secure request budget without reducing drawing resolution.`);
}

async function callAnalysis({ anonKey, accessToken, document, page, batch, maximumAttempts = 12 }) {
  let lastError = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const response = await fetch(`${supabaseUrl}/functions/v1/ecos-analyze-drawing-page`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemaVersion: 'ecos-drawing-page-analysis/2.0',
        pageNumber: page.pageNumber,
        documentName: document.name,
        discipline: document.data.drawingDiscipline || null,
        existingText: String(page.text || '').slice(0, 16_000),
        imageDataUrl: batch.overview,
        analysisPass: 'page_tiles',
        tileBounds: null,
        tileImages: batch.tiles,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.schemaVersion === 'ecos-drawing-page-analysis/2.0') return body;
    lastError = Object.assign(
      new Error(`HTTP ${response.status}: ${body?.error || 'analysis_failed'}`),
      { code: body?.error || 'analysis_failed', status: response.status },
    );
    if ([400, 401, 403, 413].includes(response.status) || [
      'analysis_quota_exhausted',
      'analysis_request_exceeds_rate_limit',
    ].includes(body?.error)) break;
    if (attempt === maximumAttempts) {
      console.log(JSON.stringify({
        event: 'analysis_blocked',
        page: page.pageNumber,
        attempt,
        error: body?.error || response.status,
        providerErrorCode: body?.providerErrorCode || null,
        retryAfterSeconds: body?.retryAfterSeconds || null,
        rateLimit: body?.rateLimit || null,
      }));
      throw lastError;
    }
    const retrySeconds = Number(body?.retryAfterSeconds);
    const waitMilliseconds = Number.isFinite(retrySeconds) && retrySeconds > 0
      ? Math.min(15 * 60_000, retrySeconds * 1_000)
      : Math.min(120_000, 5_000 * (2 ** (attempt - 1)));
    console.log(JSON.stringify({
      event: 'analysis_retry',
      page: page.pageNumber,
      attempt,
      waitSeconds: Math.round(waitMilliseconds / 1_000),
      error: body?.error || response.status,
      providerErrorCode: body?.providerErrorCode || null,
      rateLimit: body?.rateLimit || null,
    }));
    await new Promise(resolve => setTimeout(resolve, waitMilliseconds));
  }
  throw lastError || new Error(`Page ${page.pageNumber} visual analysis failed.`);
}

async function analyzePageWithAdaptiveTileBatches(input) {
  try {
    return await callAnalysis({ ...input, maximumAttempts: primaryAnalysisAttempts });
  } catch (error) {
    const code = String(error?.code || 'analysis_failed');
    if ([
      'analysis_quota_exhausted',
      'analysis_rate_limited',
      'analysis_request_exceeds_rate_limit',
      'forbidden',
      'invalid_request',
      'request_too_large',
      'signed_out',
      'unauthorized',
    ].includes(code)) {
      throw error;
    }
    console.log(JSON.stringify({
      event: 'dense_page_fallback', page: input.page.pageNumber,
      tileCount: input.batch.tiles.length, error: code,
    }));
  }

  const results = [];
  for (let index = 0; index < input.batch.tiles.length; index += 1) {
    const result = await callAnalysis({
      ...input,
      batch: { overview: input.batch.overview, tiles: [input.batch.tiles[index]] },
      maximumAttempts: 4,
    });
    results.push(result);
    console.log(JSON.stringify({
      event: 'dense_page_tile_completed', page: input.page.pageNumber,
      tile: index + 1, totalTiles: input.batch.tiles.length,
    }));
  }
  const sheetCandidates = results.map(result => result.sheetIdentity).filter(candidate =>
    candidate?.sheetNumber && candidate?.evidenceText && Number.isFinite(Number(candidate?.confidence))
  ).sort((left, right) => Number(right.confidence) - Number(left.confidence));
  const facts = [];
  const factKeys = new Set();
  for (const result of results) {
    for (const fact of result.facts || []) {
      const key = normalize(`${fact.statement} ${fact.evidenceText} ${JSON.stringify(fact.bounds || {})}`);
      if (!key || factKeys.has(key)) continue;
      factKeys.add(key);
      facts.push(fact);
    }
  }
  return {
    schemaVersion: 'ecos-drawing-page-analysis/2.0',
    facts,
    deepReadRegions: [],
    sheetIdentity: sheetCandidates[0] || null,
  };
}

async function ownerSession(admin, anonKey, ownerId) {
  const user = await admin.auth.admin.getUserById(ownerId);
  if (user.error || !user.data.user.email) throw new Error('Owner session unavailable.');
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.data.user.email });
  if (link.error || !link.data.properties.hashed_token) throw new Error('Owner verification unavailable.');
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
  if (verified.error || !verified.data.session?.access_token) throw new Error('Owner verification failed.');
  return { client, accessToken: verified.data.session.access_token };
}

function pageFromRow(row) {
  return {
    pageNumber: Number(row.page_number),
    sheetNumber: row.sheet_number || null,
    sheetTitle: row.sheet_title || null,
    sheetMappingStatus: row.sheet_mapping_status || 'unverified',
    sheetMappingConfidence: row.sheet_mapping_confidence == null ? null : Number(row.sheet_mapping_confidence),
    sheetMappingCandidates: Array.isArray(row.sheet_mapping_candidates) ? row.sheet_mapping_candidates : [],
    title: row.title || null,
    text: row.page_text || null,
    regions: Array.isArray(row.regions) ? row.regions : [],
    visualCoverage: row.visual_coverage || null,
  };
}

async function reindexDocument({ admin, ownerClient, anonKey, accessToken, document, sourcePath }) {
  const actualSha = sha256(sourcePath);
  const expectedSha = String(document.data.webFileFingerprint || document.data.indexedContentSha256 || document.data.contentSha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha) || actualSha !== expectedSha) {
    throw new Error(`${document.name}: local PDF fingerprint does not match the linked production source.`);
  }
  const actualPageCount = pageCount(sourcePath);
  if (actualPageCount !== Number(document.data.sourcePageCount)) {
    throw new Error(`${document.name}: local PDF has ${actualPageCount} pages but production expects ${document.data.sourcePageCount}.`);
  }
  const pageRows = await admin.from('ecos_document_pages')
    .select('page_number,sheet_number,sheet_title,sheet_mapping_status,sheet_mapping_confidence,sheet_mapping_candidates,visual_coverage,title,page_text,regions')
    .eq('document_id', document.id)
    .order('page_number', { ascending: true });
  if (pageRows.error) throw pageRows.error;
  const pages = (pageRows.data || []).map(pageFromRow);
  if (pages.length !== actualPageCount) throw new Error(`${document.name}: production index has ${pages.length} of ${actualPageCount} pages.`);

  const jobResult = await admin.from('ecos_document_index_jobs')
    .select('id')
    .eq('document_id', document.id)
    .eq('source_sha256', actualSha)
    .maybeSingle();
  if (jobResult.error) throw jobResult.error;
  let jobId = jobResult.data?.id;
  if (!jobId) {
    const inserted = await admin.from('ecos_document_index_jobs').insert({
      owner_id: document.ownerId,
      document_id: document.id,
      source_sha256: actualSha,
      source_page_count: actualPageCount,
      status: 'running',
    }).select('id').single();
    if (inserted.error) throw inserted.error;
    jobId = inserted.data.id;
  }
  await admin.from('ecos_document_index_jobs').update({ status: 'running', failure_message: null, updated_at: new Date().toISOString() }).eq('id', jobId);

  const checkpointRows = await admin.from('ecos_document_index_job_pages')
    .select('page_number,page_data')
    .eq('job_id', jobId)
    .order('page_number', { ascending: true });
  if (checkpointRows.error) throw checkpointRows.error;
  for (const checkpoint of checkpointRows.data || []) {
    const index = Number(checkpoint.page_number) - 1;
    if (index >= 0 && index < pages.length && checkpoint.page_data) {
      pages[index] = checkpoint.page_data;
    }
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-visual-index-'));
  try {
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      if (hasCompleteCoverage(page)) {
        console.log(JSON.stringify({ event: 'page_skipped_complete', document: document.name, page: page.pageNumber, progress: `${index + 1}/${pages.length}` }));
        continue;
      }
      const startedAt = Date.now();
      const batch = await renderPageBatch(sourcePath, page.pageNumber, directory);
      const result = await analyzePageWithAdaptiveTileBatches({
        anonKey, accessToken, document, page, batch,
      });
      const visualRegions = (result.facts || []).map((fact, factIndex) =>
        buildRegion(page.pageNumber, fact, factIndex)).filter(Boolean);
      const sheet = result.sheetIdentity || {};
      const sheetRegion = sheet.sheetNumber && sheet.evidenceText
        ? buildRegion(page.pageNumber, {
            subject: 'Sheet identity',
            location: 'Title block',
            statement: `Sheet ${sheet.sheetNumber}${sheet.sheetTitle ? ` is titled ${sheet.sheetTitle}` : ''}`,
            evidenceText: sheet.evidenceText,
            confidence: sheet.confidence,
            bounds: sheet.bounds,
          }, visualRegions.length, 'sheet_identity')
        : null;
      page.regions = [
        ...(page.regions || []).filter(region => region?.source !== 'vision'),
        ...visualRegions,
        ...(sheetRegion ? [sheetRegion] : []),
      ];
      if (sheet.sheetNumber && Number(sheet.confidence) >= 0.9) {
        page.sheetNumber = sheet.sheetNumber;
        page.sheetTitle = sheet.sheetTitle || null;
        page.sheetMappingStatus = 'verified';
        page.sheetMappingConfidence = Number(sheet.confidence);
        page.sheetMappingCandidates = [{
          sheetNumber: sheet.sheetNumber,
          source: 'vision',
          confidence: Number(sheet.confidence),
          evidenceText: sheet.evidenceText,
        }];
      }
      page.visualCoverage = {
        overviewAnalyzed: true,
        requestedDeepReadRegionCount: 6,
        completedDeepReadRegionCount: 6,
        coverageComplete: true,
        completedDeepReadRegionKeys: [...tileKeys],
        failureCodes: [],
      };
      const checkpoint = await admin.from('ecos_document_index_job_pages').upsert({
        owner_id: document.ownerId,
        job_id: jobId,
        page_number: page.pageNumber,
        page_data: page,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'owner_id,job_id,page_number' });
      if (checkpoint.error) throw checkpoint.error;
      await admin.from('ecos_document_index_jobs').update({
        completed_page_count: pages.filter(hasCompleteCoverage).length,
        updated_at: new Date().toISOString(),
      }).eq('id', jobId);
      console.log(JSON.stringify({
        event: 'page_completed', document: document.name, page: page.pageNumber,
        sheet: page.sheetNumber, factCount: visualRegions.length,
        seconds: Math.round((Date.now() - startedAt) / 100) / 10,
        progress: `${index + 1}/${pages.length}`,
      }));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  if (!pages.every(hasCompleteCoverage)) throw new Error(`${document.name}: visual coverage is not complete after processing.`);
  const replaced = await ownerClient.rpc('ecos_commit_verified_index_job', {
    p_job_id: jobId,
    p_extraction_method: document.data.extractionMethod || null,
  });
  if (replaced.error) throw replaced.error;
  console.log(JSON.stringify({ event: 'document_completed', document: document.name, pages: actualPageCount }));
}

(async () => {
  const keys = JSON.parse(execFileSync('npx', [
    '--yes', 'supabase@2.75.0', 'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
  ], { cwd: __dirname + '/..', encoding: 'utf8' }));
  const serviceKey = keys.find(key => key.name === 'service_role')?.api_key;
  const anonKey = keys.find(key => key.name === 'anon')?.api_key;
  if (!serviceKey || !anonKey) throw new Error('Supabase credentials are unavailable.');
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = await admin.from('reference_documents').select('id,owner_id,name,category,document_data,updated_at');
  if (rows.error) throw rows.error;
  const documents = (rows.data || []).filter(row => {
    const data = row.document_data || {};
    return String(row.category || data.category || '').toLowerCase() === 'drawing' &&
      data.isCurrent === true &&
      projectNames(data).some(name => normalize(name) === normalize(projectName)) &&
      (!requestedPattern || new RegExp(requestedPattern, 'i').test(row.name));
  }).map(row => ({ id: row.id, ownerId: row.owner_id, name: row.name, data: row.document_data || {} }));
  if (documents.length === 0) throw new Error('No current 2375 drawing matched the requested pattern.');
  const sources = sourceDirectories.flatMap(directory => fs.readdirSync(directory)
    .filter(name => /\.pdf$/i.test(name))
    .map(name => ({ name, filePath: path.join(directory, name) })));
  const { client: ownerClient, accessToken } = await ownerSession(admin, anonKey, documents[0].ownerId);
  for (const document of documents) {
    const source = sources.find(candidate => normalize(candidate.name) === normalize(document.name));
    if (!source) throw new Error(`${document.name}: matching local PDF was not found.`);
    await reindexDocument({ admin, ownerClient, anonKey, accessToken, document, sourcePath: source.filePath });
  }
})().catch(async error => {
  console.error(JSON.stringify({
    event: 'fatal', message: error?.message || String(error), code: error?.code || null,
    details: error?.details || null,
  }));
  process.exitCode = 1;
});
