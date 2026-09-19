const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createCanvas, loadImage } = require('../node_modules/@napi-rs/canvas');
const { createClient } = require('../node_modules/@supabase/supabase-js');

const projectRef = 'xdytqlpsqsseoeuxgzre';
const supabaseUrl = `https://${projectRef}.supabase.co`;
const documentName = '01 - PLZ CORP - 2375 THIRD STREET - ARCHITECTURAL';
const defaultPdf = '/Users/davidfamularo/Downloads/01 - PLZ CORP - 2375 THIRD STREET - ARCHITECTURAL.pdf';
const sourcePath = path.resolve(process.argv[2] || defaultPdf);
const pdfInfo = '/Users/davidfamularo/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdfinfo';
const pdfToPpm = '/Users/davidfamularo/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm';
const outputPath = path.resolve(
  process.env.ECOS_GEMINI_COMPARISON_OUTPUT || 'validation/output/ecos-gemini-drawing-comparison.json',
);
const tileBounds = [
  { x: 0, y: 0, width: 1 / 3, height: 0.5 },
  { x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 },
  { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 },
  { x: 0, y: 0.5, width: 1 / 3, height: 0.5 },
  { x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
  { x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
];
const cases = [
  {
    pageNumber: 8,
    expectedSheet: 'A-1.1',
    expectedEvidence: [/storage\s*["']?c/i, /haz(?:ardous)?\.?\s*(?:mat|material|storage)/i, /2\s*,?\s*712\s*(?:s\.?\s*f\.?|square)/i],
  },
  {
    pageNumber: 13,
    expectedSheet: 'A-1.6',
    expectedEvidence: [/storage\s*(?:area|canopy)?\s*["']?c/i, /haz(?:ardous)?\.?\s*(?:mat|material)/i],
  },
  {
    pageNumber: 20,
    expectedSheet: 'A-1.13',
    expectedEvidence: [/canopy\s*c/i, /hazardous\s+material\s+summary/i],
  },
];
const requestedPages = new Set(String(process.env.ECOS_GEMINI_COMPARISON_PAGES || '')
  .split(',').map(value => value.trim()).filter(Boolean).map(Number).filter(Number.isInteger));
const selectedCases = requestedPages.size > 0
  ? cases.filter(testCase => requestedPages.has(testCase.pageNumber))
  : cases;
const comparisonStrategy = process.env.ECOS_GEMINI_COMPARISON_STRATEGY === 'whole_page_tiles'
  ? 'whole_page_tiles'
  : 'split_tiles';
if (selectedCases.length < 1) throw new Error('No recognized Gemini comparison pages were selected.');

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  try {
    let bytesRead = 0;
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
  if (!Number.isInteger(count) || count < 1) throw new Error('Could not verify the PDF page count.');
  return count;
}

function dataUrl(buffer) {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function renderPage(filePath, pageNumber, directory) {
  const prefix = path.join(directory, `gemini-page-${pageNumber}`);
  execFileSync(pdfToPpm, [
    '-f', String(pageNumber), '-l', String(pageNumber), '-singlefile',
    '-jpeg', '-jpegopt', 'quality=82', '-scale-to-x', '9000', '-scale-to-y', '-1',
    filePath, prefix,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  const renderedPath = `${prefix}.jpg`;
  const source = await loadImage(renderedPath);
  const overviewWidth = 2_400;
  const overviewHeight = Math.max(1, Math.round(source.height * (overviewWidth / source.width)));
  const overviewCanvas = createCanvas(overviewWidth, overviewHeight);
  overviewCanvas.getContext('2d').drawImage(source, 0, 0, overviewWidth, overviewHeight);
  const tileCanvases = tileBounds.map(bounds => {
    const left = Math.round(source.width * bounds.x);
    const top = Math.round(source.height * bounds.y);
    const width = Math.round(source.width * bounds.width);
    const height = Math.round(source.height * bounds.height);
    const canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(source, left, top, width, height, 0, 0, width, height);
    return canvas;
  });
  fs.rmSync(renderedPath, { force: true });
  for (const quality of [82, 74, 66, 58, 50]) {
    const overview = await overviewCanvas.encode('jpeg', quality);
    const tiles = [];
    for (const canvas of tileCanvases) tiles.push(await canvas.encode('jpeg', quality));
    const requestCharacters = [overview, ...tiles]
      .reduce((sum, image) => sum + 24 + Math.ceil(image.length / 3) * 4, 0);
    if (requestCharacters <= 17_800_000) {
      return {
        overview: dataUrl(overview),
        tiles: tiles.map((tile, index) => ({
          bounds: tileBounds[index],
          imageDataUrl: dataUrl(tile),
        })),
      };
    }
  }
  throw new Error(`Page ${pageNumber} does not fit the secure comparison request budget.`);
}

async function ownerSession(admin, anonKey, ownerId) {
  const user = await admin.auth.admin.getUserById(ownerId);
  if (user.error || !user.data.user.email) throw new Error('Owner session unavailable.');
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.data.user.email });
  if (link.error || !link.data.properties.hashed_token) throw new Error('Owner verification unavailable.');
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: 'magiclink',
  });
  if (verified.error || !verified.data.session?.access_token) throw new Error('Owner verification failed.');
  return verified.data.session.access_token;
}

async function analyzeWithGemini({ anonKey, accessToken, document, page, batch }) {
  const response = await fetch(`${supabaseUrl}/functions/v1/ecos-analyze-drawing-page`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      schemaVersion: 'ecos-drawing-page-analysis/2.0',
      comparisonMode: true,
      visionProvider: 'gemini',
      pageNumber: page.page_number,
      documentName: document.name,
      discipline: document.document_data?.drawingDiscipline || null,
      existingText: String(page.page_text || '').slice(0, 16_000),
      imageDataUrl: batch.overview,
      analysisPass: 'page_tiles',
      tileImages: batch.tiles,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const providerDetail = [body?.providerErrorCode, body?.comparisonProviderMessage]
      .filter(Boolean).join(' — ');
    const error = new Error(
      `Gemini comparison failed for page ${page.page_number}: ${body?.error || `HTTP ${response.status}`}` +
      (providerDetail ? ` (${providerDetail})` : '') +
      (body?.comparisonAssuranceDiagnostics
        ? `\n${JSON.stringify(body.comparisonAssuranceDiagnostics, null, 2)}`
        : ''),
    );
    error.code = body?.error || 'comparison_failed';
    throw error;
  }
  return body;
}

async function analyzeSplitTilesWithGemini({ anonKey, accessToken, document, page, batch }) {
  const tileResults = [];
  for (let start = 0; start < batch.tiles.length; start += 2) {
    const pair = batch.tiles.slice(start, start + 2);
    const pairResults = await Promise.all(pair.map(async (tile, offset) => {
      const tileIndex = start + offset;
      const response = await fetch(`${supabaseUrl}/functions/v1/ecos-analyze-drawing-page`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schemaVersion: 'ecos-drawing-page-analysis/2.0',
          comparisonMode: true,
          visionProvider: 'gemini',
          pageNumber: page.page_number,
          documentName: document.name,
          discipline: document.document_data?.drawingDiscipline || null,
          existingText: String(page.page_text || '').slice(0, 16_000),
          imageDataUrl: tile.imageDataUrl,
          tileBounds: tile.bounds,
          analysisPass: 'deep_read',
          analysisFocus: 'Read every visible construction label, schedule, table, note, dimension, and named area in this high-resolution page tile.',
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const details = body?.comparisonAnalysisDiagnostics || body?.comparisonAssuranceDiagnostics ||
          body?.comparisonProviderMessage || null;
        throw new Error(`tile ${tileIndex}: ${body?.error || `HTTP ${response.status}`}${details ? ` ${JSON.stringify(details)}` : ''}`);
      }
      return { tileIndex, body };
    }));
    tileResults.push(...pairResults);
  }
  const bodies = tileResults.map(result => result.body);
  const sheetCandidates = bodies.map(body => body.sheetIdentity).filter(sheet => sheet?.sheetNumber);
  const sheetIdentity = sheetCandidates.sort((left, right) =>
    Number(right.confidence || 0) - Number(left.confidence || 0))[0] || null;
  return {
    schemaVersion: 'ecos-drawing-page-analysis/2.0',
    pageNumber: page.page_number,
    facts: tileResults.flatMap(({ tileIndex, body }) => (body.facts || []).map(fact => ({ ...fact, tileIndex }))),
    sheetIdentity,
    deepReadRegions: [],
    visionProvider: bodies[0]?.visionProvider || 'gemini',
    model: bodies[0]?.model || null,
    comparisonDiagnostics: {
      strategy: 'split_tiles',
      tileCount: tileResults.length,
      tiles: tileResults.map(({ tileIndex, body }) => ({
        tileIndex,
        factCount: Array.isArray(body.facts) ? body.facts.length : 0,
        sheetIdentity: body.sheetIdentity || null,
        assurance: body.comparisonDiagnostics?.assurance || null,
        schemaFallbackReason: body.comparisonDiagnostics?.schemaFallbackReason || null,
      })),
    },
  };
}

function factText(result) {
  return (result.facts || []).map(fact => [
    fact.subject, fact.location, fact.statement, fact.evidenceText,
  ].filter(Boolean).join(' ')).join('\n');
}

function existingVisionText(page) {
  return (page.regions || []).filter(region => region?.source === 'vision')
    .map(region => String(region.text || region.label || ''))
    .join('\n');
}

function expectationResult(testCase, result) {
  const text = `${result.sheetIdentity?.sheetNumber || ''}\n${factText(result)}`;
  const evidenceChecks = testCase.expectedEvidence.map(pattern => ({
    pattern: pattern.source,
    passed: pattern.test(text),
  }));
  return {
    expectedSheet: testCase.expectedSheet,
    sheetPassed: String(result.sheetIdentity?.sheetNumber || '').toUpperCase() === testCase.expectedSheet,
    evidenceChecks,
    passed: String(result.sheetIdentity?.sheetNumber || '').toUpperCase() === testCase.expectedSheet &&
      evidenceChecks.every(check => check.passed),
  };
}

(async () => {
  if (!fs.existsSync(sourcePath)) throw new Error(`Comparison PDF was not found: ${sourcePath}`);
  const keys = JSON.parse(execFileSync('npx', [
    '--yes', 'supabase@2.75.0', 'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }));
  const serviceKey = keys.find(key => key.name === 'service_role')?.api_key;
  const anonKey = keys.find(key => key.name === 'anon')?.api_key;
  if (!serviceKey || !anonKey) throw new Error('Supabase credentials are unavailable.');
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const documents = await admin.from('reference_documents')
    .select('id,owner_id,name,document_data')
    .eq('name', documentName)
    .limit(1)
    .single();
  if (documents.error) throw documents.error;
  const document = documents.data;
  const expectedSha = String(
    document.document_data?.webFileFingerprint || document.document_data?.indexedContentSha256 || '',
  ).toLowerCase();
  const actualSha = sha256(sourcePath);
  if (!/^[a-f0-9]{64}$/.test(expectedSha) || actualSha !== expectedSha) {
    throw new Error('The local PDF does not match the current production drawing fingerprint.');
  }
  const actualPageCount = pageCount(sourcePath);
  if (actualPageCount !== Number(document.document_data?.sourcePageCount)) {
    throw new Error('The local PDF page count does not match the current production drawing.');
  }
  const pagesResult = await admin.from('ecos_document_pages')
    .select('page_number,page_text,regions,sheet_number')
    .eq('document_id', document.id)
    .in('page_number', selectedCases.map(testCase => testCase.pageNumber))
    .order('page_number', { ascending: true });
  if (pagesResult.error) throw pagesResult.error;
  const pages = new Map((pagesResult.data || []).map(page => [Number(page.page_number), page]));
  const accessToken = await ownerSession(admin, anonKey, document.owner_id);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-gemini-comparison-'));
  const results = [];
  try {
    for (const testCase of selectedCases) {
      const page = pages.get(testCase.pageNumber);
      if (!page) throw new Error(`Production page ${testCase.pageNumber} is unavailable.`);
      const batch = await renderPage(sourcePath, testCase.pageNumber, directory);
      const startedAt = Date.now();
      const gemini = comparisonStrategy === 'split_tiles'
        ? await analyzeSplitTilesWithGemini({ anonKey, accessToken, document, page, batch })
        : await analyzeWithGemini({ anonKey, accessToken, document, page, batch });
      const expectation = expectationResult(testCase, gemini);
      results.push({
        pageNumber: testCase.pageNumber,
        currentSheet: page.sheet_number || null,
        provider: gemini.visionProvider || null,
        model: gemini.model || null,
        elapsedMilliseconds: Date.now() - startedAt,
        expectation,
        gemini: {
          sheetIdentity: gemini.sheetIdentity || null,
          factCount: Array.isArray(gemini.facts) ? gemini.facts.length : 0,
          facts: gemini.facts || [],
          comparisonDiagnostics: gemini.comparisonDiagnostics || null,
        },
        currentProductionIndex: {
          provider: 'openai',
          excerpt: existingVisionText(page).slice(0, 12_000),
        },
      });
      if (testCase !== selectedCases[selectedCases.length - 1]) {
        await new Promise(resolve => setTimeout(resolve, 4_000));
      }
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const report = {
    schemaVersion: 'ecos-gemini-drawing-comparison/1.0',
    createdAt: new Date().toISOString(),
    projectRef,
    documentName,
    sourceSha256: actualSha,
    sourcePageCount: actualPageCount,
    persistenceMode: 'read_only_no_index_writes',
    comparisonStrategy,
    passed: results.every(result => result.expectation.passed),
    passedCases: results.filter(result => result.expectation.passed).length,
    totalCases: results.length,
    results,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Gemini drawing comparison: ${report.passedCases}/${report.totalCases} passed.`);
  console.log(`Evidence: ${outputPath}`);
  if (!report.passed) process.exitCode = 1;
})().catch(error => {
  console.error(`Gemini drawing comparison blocked: ${error?.message || String(error)}`);
  process.exitCode = 1;
});
