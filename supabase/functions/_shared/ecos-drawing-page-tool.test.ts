import { assertEquals } from 'jsr:@std/assert@1';
import { createECOSAgentProjectToolRegistry, type ECOSAgentProjectSource } from './ecos-agent-project-tools.ts';

const original: ECOSAgentProjectSource = { id: 'found-source', sourceType: 'document', title: 'Office Drawing',
  excerpt: 'Office cabinetry', updatedAt: null, score: 1,
  documentCitation: { projectId: 'project-a', documentId: 'doc-a', sourceSha256: 'a'.repeat(64),
    evidenceVersion: 'v1', revision: '1', pageNumber: 3 } };
const context = () => ({signal: new AbortController().signal});
function setup(read = async () => [original], inspect = async () => 'available' as const) {
  return createECOSAgentProjectToolRegistry({ candidates: [original], snapshotCapturedAt: '2026-09-15',
    inventory: { sourceCounts: {document: 1}, unavailableChannels: [], limitations: [], candidateCount: 1 },
    inspectDocumentProof: inspect,
    searchCurrentDocuments: async () => ({sources: [original], semanticAvailable: false, matchedPageCount: 1}),
    readCurrentDrawingPage: read });
}
async function call(registry: ReturnType<typeof setup>, name: string, args: Record<string, unknown>) {
  return await registry.tools.find(tool => tool.name === name)!.execute(args, context()) as Record<string, unknown>;
}
const request = {sourceId: original.id, pageNumber: 3, question: 'What cabinetry is shown?'};
async function research(registry: ReturnType<typeof setup>) {
  await call(registry, 'search_project_evidence', {query: 'office cabinetry', sourceTypes: ['document'], limit: 8});
}
Deno.test('page tool requires actual research before allowing page access', async () => {
  let reads = 0;
  const registry = setup(async () => { reads++; return [original]; });
  assertEquals((await call(registry, 'read_project_drawing_page', request)).error, 'researched_drawing_required');
  await research(registry);
  const result = await call(registry, 'read_project_drawing_page', request);
  assertEquals(result.mode, 'prepared_text_only');
  assertEquals(reads, 1);
});
Deno.test('page tool rejects cross-project/file/revision/hash/version/page results', async () => {
  const wrong = Object.entries({ projectId: 'other', documentId: 'other', revision: '2',
    sourceSha256: 'b'.repeat(64), evidenceVersion: 'v0', pageNumber: 4 }).map(([key, value]) =>
      ({ ...original, id: `wrong-${key}`, documentCitation: {...original.documentCitation, [key]: value} }));
  const registry = setup(async () => [...wrong, original]);
  await research(registry);
  const result = await call(registry, 'read_project_drawing_page', request);
  assertEquals((result.sources as {id: string}[]).map(source => source.id), [original.id]);
  assertEquals(registry.researchSources().map(source => source.id), [original.id]);
});
Deno.test('page tool validates numbers and never accepts arbitrary file URLs', async () => {
  let reads = 0;
  const registry = setup(async () => {reads++; return [];});
  await research(registry);
  for (const pageNumber of ['3', true, 0, -1, 1.5, NaN, Infinity]) {
    assertEquals((await call(registry, 'read_project_drawing_page', {...request, pageNumber})).error, 'exact_pdf_page_and_question_required');
  }
  assertEquals((await call(registry, 'read_project_drawing_page', {...request, sourceId: 'https://private/file.pdf'})).error, 'researched_drawing_required');
  assertEquals(reads, 0);
});
Deno.test('exact page reads share the existing four fresh-document searches', async () => {
  let reads = 0;
  const registry = setup(async () => {reads++; return [original];});
  await research(registry);
  for (let i = 0; i < 3; i++) await call(registry, 'search_current_project_documents', {query: 'cabinetry', limit: 8});
  await call(registry, 'read_project_drawing_page', request);
  assertEquals((await call(registry, 'read_project_drawing_page', request)).error, 'document_search_budget_reached');
  assertEquals(reads, 1);
});
Deno.test('page tool is absent unless the server supplies an authorized reader', () => {
  const registry = createECOSAgentProjectToolRegistry({candidates: [original], snapshotCapturedAt: '',
    inventory: {sourceCounts: {}, unavailableChannels: [], limitations: [], candidateCount: 1},
    searchCurrentDocuments: async () => ({sources: [], matchedPageCount: 0, semanticAvailable: false})});
  assertEquals(registry.tools.some(tool => tool.name === 'read_project_drawing_page'), false);
});
