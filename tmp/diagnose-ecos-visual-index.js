const { execFileSync } = require('node:child_process');
const { createClient } = require('../node_modules/@supabase/supabase-js');

const projectRef = 'xdytqlpsqsseoeuxgzre';
const supabaseUrl = `https://${projectRef}.supabase.co`;
const keys = JSON.parse(execFileSync('npx', [
  '--yes', 'supabase@2.75.0', 'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
], { cwd: __dirname + '/..', encoding: 'utf8' }));
const serviceKey = keys.find(key => key.name === 'service_role')?.api_key;
if (!serviceKey) throw new Error('Supabase service credential is unavailable.');

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function projects(documentData) {
  return [documentData?.projectName, ...(Array.isArray(documentData?.projectNames) ? documentData.projectNames : [])]
    .filter(Boolean);
}

function coverageSummary(rows) {
  const failures = new Map();
  let complete = 0;
  let overview = 0;
  let tilesCompleted = 0;
  let tilesRequested = 0;
  for (const row of rows) {
    const coverage = row.visual_coverage || {};
    if (coverage.overviewAnalyzed === true) overview += 1;
    if (coverage.coverageComplete === true) complete += 1;
    tilesCompleted += Number(coverage.completedDeepReadRegionCount || 0);
    tilesRequested += Number(coverage.requestedDeepReadRegionCount || 0);
    for (const code of Array.isArray(coverage.failureCodes) ? coverage.failureCodes : []) {
      failures.set(code, (failures.get(code) || 0) + 1);
    }
  }
  return {
    pages: rows.length,
    overview,
    complete,
    tilesCompleted,
    tilesRequested,
    failures: Object.fromEntries([...failures.entries()].sort()),
  };
}

(async () => {
  const documentsResult = await admin.from('reference_documents')
    .select('id,name,category,document_data,updated_at')
    .order('updated_at', { ascending: false });
  if (documentsResult.error) throw documentsResult.error;
  const documents = (documentsResult.data || []).filter(row =>
    projects(row.document_data).some(name => /2375\s+Compliance\s+Project/i.test(name)) &&
    String(row.category || row.document_data?.category || '').toLowerCase() === 'drawing');

  const report = [];
  for (const document of documents) {
    const [pagesResult, jobsResult, chunksResult, hazardResult] = await Promise.all([
      admin.from('ecos_document_pages')
        .select('page_number,sheet_number,sheet_title,sheet_mapping_status,visual_coverage,index_schema_version,indexed_at')
        .eq('document_id', document.id)
        .order('page_number', { ascending: true }),
      admin.from('ecos_document_index_jobs')
        .select('id,status,source_page_count,completed_page_count,failure_message,updated_at')
        .eq('document_id', document.id)
        .order('updated_at', { ascending: false }),
      admin.from('ecos_document_chunks')
        .select('document_id', { count: 'exact', head: true })
        .eq('document_id', document.id),
      admin.from('ecos_document_chunks')
        .select('page_number,sheet_number,chunk_text,metadata')
        .eq('document_id', document.id)
        .or('chunk_text.ilike.%haz%,chunk_text.ilike.%matl%,chunk_text.ilike.%hazardous%')
        .limit(30),
    ]);
    for (const result of [pagesResult, jobsResult, chunksResult, hazardResult]) {
      if (result.error) throw result.error;
    }
    const data = document.document_data || {};
    report.push({
      id: document.id,
      name: document.name,
      current: data.isCurrent === true,
      discipline: data.drawingDiscipline || null,
      sourceProvider: data.sourceProvider || null,
      sourcePageCount: data.sourcePageCount ?? null,
      extractionStatus: data.extractionStatus || null,
      intelligenceVersion: data.documentIntelligenceVersion || null,
      indexedAt: data.indexedAt || null,
      limitationCount: Array.isArray(data.extractionLimitations) ? data.extractionLimitations.length : 0,
      coverage: coverageSummary(pagesResult.data || []),
      incompletePages: (pagesResult.data || []).filter(row => row.visual_coverage?.coverageComplete !== true).map(row => ({
        page: row.page_number,
        sheet: row.sheet_number,
        mapping: row.sheet_mapping_status,
        coverage: row.visual_coverage || null,
      })),
      jobs: jobsResult.data || [],
      chunkCount: chunksResult.count || 0,
      hazardMatches: (hazardResult.data || []).map(row => ({
        page: row.page_number,
        sheet: row.sheet_number,
        text: String(row.chunk_text || '').slice(0, 500),
        source: row.metadata?.source || null,
        coverageComplete: row.metadata?.visualCoverage?.coverageComplete === true,
      })),
    });
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {
  console.error(JSON.stringify({
    message: error?.message || null,
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
  }));
  process.exitCode = 1;
});
