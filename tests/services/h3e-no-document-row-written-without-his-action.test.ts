/**
 * High item 3e (the coordinator's decision, 13 Oct 2026, option A). A write of a document's row starts the cloud's
 * own work on it: the hosted-preparation trigger fires on every update of document_data and can queue a full, paid
 * preparation of a drawing (NOTES-H3e.txt, step 0). So the app writes a document's row only as part of something he
 * does: his upload, his edit, his link, his report, his Archive / Restore, his delete. The drawing-piece backfill of
 * 3d (the desktop wrote rows nobody had touched, after reading the list) is gone; a later build may bring it back
 * once the cloud's trigger leaves a change of the citation key alone.
 *
 * Kept: (1) reading the document list on the desktop, full or partial, writes no document row; (2) every place the
 * app can write a document row, each the code of an action he takes, so that a new one has to be added here on
 * purpose; (3) the citation key is still sent inside his own first upload and his own edits (3d's writers).
 * Made-up project and drawing.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { compactECOSDocumentIndexForCloud } from '../../services/ECOSDocumentIndexPersistence';
import { createFakeWebCloud } from '../fixtures/fake-web-cloud';
import type { ReferenceDocument } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

const ROOT = path.resolve(__dirname, '../..');
const SHA = 'c'.repeat(64);
const PAGE = {
  pageNumber: 1, sheetNumber: null, text: 'SITE PLAN - LOT',
  regions: [{ id: 'region-lot', label: 'Lot', text: 'LOT 7 - NEW PAVING', areaNames: ['Lot'], confidence: 0.95, x: 0.1, y: 0.1, width: 0.4, height: 0.3, source: 'embedded_text' }],
};
const DRAWING = {
  id: 'doc-a201', name: 'A-201 Site plan', originalFileName: 'A-201 Site plan.pdf', category: 'Plans', notes: '', isCurrent: true,
  importedAt: '2026-09-21T15:00:00.000Z', updatedAt: '2026-09-21T15:00:00.000Z', projectName: 'Alpha', projectNames: ['Alpha'],
  storagePath: 'owner-1/doc-a201/A-201-Site-plan.pdf', sourceProvider: 'supabase_storage', sizeBytes: 1000, contentSha256: SHA, indexedContentSha256: SHA,
  drawingNumber: 'A-201', drawingRevision: 'C', drawingStatus: 'For Construction', extractionStatus: 'complete', extractedText: 'SITE PLAN - LOT', extractedPages: [PAGE],
} as unknown as ReferenceDocument;

/** The desktop's own gateway over a cloud whose document list is the live one, recording every write to a document row. */
function desktopOverTheLiveList() {
  const cloud = createFakeWebCloud();
  // Drawings as earlier builds sent them: the whole page index in the row, no citation key; one with no index.
  // (The fake cloud answers any select with whole rows: `pages` stands for a narrow read of document_data->extractedPages.)
  cloud.insert('reference_documents', { id: 'doc-a201', owner_id: 'owner-1', name: 'A-201 Site plan', category: 'Plans', document_data: JSON.parse(JSON.stringify(DRAWING)), pages: [PAGE], updated_at: '2026-09-21T15:01:00.000Z' });
  cloud.insert('reference_documents', { id: 'doc-a202', owner_id: 'owner-1', name: 'A-202 Floor plan', category: 'Plans', document_data: { ...JSON.parse(JSON.stringify(DRAWING)), id: 'doc-a202', name: 'A-202 Floor plan', extractedPages: [], extractedText: null }, pages: [], updated_at: '2026-09-21T15:02:00.000Z' });
  const before = JSON.parse(JSON.stringify(cloud.rows('reference_documents')));
  const writes: string[] = [];
  const client = {
    ...cloud.client,
    // The live list: document_data without extractedPages and extractedText; every other key as it is.
    rpc: async (name: string) => (name === 'dave_list_reference_document_metadata'
      ? { data: cloud.rows('reference_documents').map(row => { const { extractedPages: _p, extractedText: _t, ...data } = row.document_data as Record<string, unknown>; return { ...row, document_data: data }; }), error: null, status: 200 }
      : cloud.client.rpc(name)),
    from: (table: string) => {
      const query = cloud.client.from(table) as Record<string, unknown>;
      if (table !== 'reference_documents') return query;
      return new Proxy(query, {
        get(target, property) {
          if (['insert', 'update', 'upsert', 'delete'].includes(String(property))) writes.push(String(property));
          return target[property as string];
        },
      });
    },
  };
  return { cloud, before, writes, gateway: createDAVEWebSupabaseGateway(client as never) };
}
const settle = async () => { for (let turn = 0; turn < 20; turn += 1) await new Promise(resolve => setTimeout(resolve, 0)); };

describe('no document row is written but as part of something he does', () => {
  it('the desktop reading its document list (a page load, a partial refresh) writes no document row, and leaves every row as it was', async () => {
    const { cloud, before, writes, gateway } = desktopOverTheLiveList();
    await gateway.loadAuthorizedRows();
    await settle();
    await gateway.loadAuthorizedRows(['reference_documents']);
    await settle();
    expect(writes).toEqual([]);
    expect(cloud.rows('reference_documents')).toEqual(before);
  });

  it('the drawing-piece backfill is gone: no module, and nothing calls it', () => {
    expect(fs.existsSync(path.join(ROOT, 'services/DrawingCitationBackfill.ts'))).toBe(false);
    const sources = ['services', 'components', 'screens', 'hooks', 'providers']
      .flatMap(folder => walk(path.join(ROOT, folder)))
      .concat(path.join(ROOT, 'App.tsx'));
    const callers = sources.filter(file => /DrawingCitationBackfill|backfillDrawingCitationPageIndexes/.test(fs.readFileSync(file, 'utf8')));
    expect(callers).toEqual([]);
  });

  it('every place the app can write a document row is the code of an action he takes', () => {
    // Each: the file, the function the write is in, and what he does that runs it. A new place must be added here
    // on purpose (and must not write a row he has not touched: the cloud starts its own work on every such write).
    expect(documentRowWrites()).toEqual([
      'services/DAVEWebSupabaseClient.ts compensateFailedDocumentImport delete (takes back his upload on the computer when it failed half-way)',
      'services/DAVEWebSupabaseClient.ts compensateFailedLinkedDocumentImport delete (takes back his Google Drive link when it failed half-way)',
      'services/DAVEWebSupabaseClient.ts saveAuthorizedLinkedReferenceDocument insert (his Google Drive link)',
      'services/DAVEWebSupabaseClient.ts saveAuthorizedReportArtifact update (his saved report)',
      'services/DAVEWebSupabaseClient.ts setAuthorizedDocumentArchived update (his confirmed Archive or explicit Restore on the computer; archived_at only)',
      'services/DAVEWebSupabaseClient.ts updateAuthorizedReferenceDocument update (his edit of the details on the computer)',
      'services/DAVEWebSupabaseClient.ts uploadAuthorizedReferenceDocument insert (his upload on the computer)',
      'services/SharedDocumentArchive.ts syncOnce update (his Archive or Restore taps; the archived_at column only)',
      'services/SupabaseService.ts upsertReferenceDocument update/upsert (his upload or edit on the phone or iPad, sent by the upload queue or Sync Now)',
    ].map(entry => entry.replace(/ \(.*\)$/, '')));
  });
});

describe('the citation key still goes up inside his own sends (3d\'s writers)', () => {
  it('his first upload of a drawing he has read, and his later edit of its details, carry the citation key', () => {
    const firstUpload = compactECOSDocumentIndexForCloud(DRAWING) as ReferenceDocument & Record<string, any>;
    expect(firstUpload.citationPageIndex?.pages?.[0]?.regions?.map((region: { id: string }) => region.id)).toEqual(['region-lot']);
    // Later, the device holds the list's copy (no page index of its own) and he edits a note.
    const held = { ...DRAWING, extractedPages: [], extractedText: null, listedPageIndex: firstUpload.citationPageIndex, notes: 'Checked on site' } as ReferenceDocument;
    const edit = compactECOSDocumentIndexForCloud(held) as ReferenceDocument & Record<string, any>;
    expect(edit.citationPageIndex).toEqual(firstUpload.citationPageIndex);
    expect(edit).not.toHaveProperty('listedPageIndex');
    // The desktop's edit goes through the same compaction (referenceDocumentRow), so it carries the key as well.
    expect(fs.readFileSync(path.join(ROOT, 'services/DAVEWebSupabaseClient.ts'), 'utf8')).toContain(': compactECOSDocumentIndexForCloud(document);');
  });
});

function walk(folder: string): string[] {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Every write to the documents table in the app's code: the file, the function it is in, the operations. */
function documentRowWrites(): string[] {
  const files = ['services', 'components', 'screens', 'hooks', 'providers'].flatMap(folder => walk(path.join(ROOT, folder))).concat(path.join(ROOT, 'App.tsx'));
  const found = new Map<string, Set<string>>();
  files.forEach(file => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const relative = path.relative(ROOT, file);
    const tableNames = new Set(["'reference_documents'"]);
    lines.forEach(line => {
      const constant = /const (\w+) = 'reference_documents';/.exec(line);
      if (constant) tableNames.add(constant[1]);
    });
    lines.forEach((line, index) => {
      const helperWrite = (name: string) => line.includes(`table: ${name},`) &&
        /updateOwnedJsonRecord|upsertJsonRecord/.test(lines.slice(Math.max(0, index - 3), index + 1).join('\n'));
      const reachesTable = [...tableNames].some(name => line.includes(`from(${name})`) || helperWrite(name));
      if (!reachesTable) return;
      const statement = lines.slice(index, index + 12).join('\n');
      const operations = line.includes('table: ')
        ? (/updateOwnedJsonRecord/.test(lines.slice(Math.max(0, index - 3), index + 1).join('\n')) ? ['update'] : ['upsert'])
        : ['insert', 'update', 'upsert', 'delete'].filter(operation => new RegExp(`\\.${operation}\\(`).test(statement.split(/;\s*\n/)[0] + (statement.includes('let query') ? statement : '')));
      if (operations.length === 0) return;
      const owner = enclosingFunction(lines, index);
      const key = `${relative} ${owner}`;
      if (!found.has(key)) found.set(key, new Set());
      operations.forEach(operation => found.get(key)!.add(operation));
    });
  });
  return [...found.entries()].map(([key, operations]) => `${key} ${[...operations].join('/')}`).sort();
}

function enclosingFunction(lines: string[], index: number): string {
  for (let at = index; at >= 0; at -= 1) {
    // A function of the module, or a method of the desktop's gateway (four spaces in).
    const match = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(lines[at]) ||
      /^ {4}(?:async\s+)?(\w+)\s*\([^)]*$|^ {4}(?:async\s+)?(\w+)\s*\(.*\)\s*(?::\s*[^=]+)?\{\s*$/.exec(lines[at]);
    if (match) {
      const name = match[1] || match[2] || match[3];
      if (name && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(name)) return name;
    }
  }
  return '(top level)';
}

// The inventory entry is narrow: it grants no authority to rewrite metadata or
// to invoke the archive gateway from a loader/background effect.
it('the added desktop archive writer changes only its archive column and has only the explicit provider action caller',()=>{
 const file=path.join(ROOT,'services/DAVEWebSupabaseClient.ts');const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 let method:ts.MethodDeclaration|undefined;const visit=(n:ts.Node)=>{if(ts.isMethodDeclaration(n)&&n.name.getText(source)==='setAuthorizedDocumentArchived')method=n;ts.forEachChild(n,visit);};visit(source);expect(method).toBeDefined();
 const patches:string[][]=[];const writes=(n:ts.Node)=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='update'){const arg=n.arguments[0];expect(ts.isObjectLiteralExpression(arg)).toBe(true);if(ts.isObjectLiteralExpression(arg))patches.push(arg.properties.map(p=>p.name?.getText(source)??''));}ts.forEachChild(n,writes);};writes(method!);expect(patches).toEqual([['archived_at']]);
 const callers:string[]=[];
 for(const file of ['services','components','screens','hooks','providers'].flatMap(folder=>walk(path.join(ROOT,folder))).concat(path.join(ROOT,'App.tsx'))){
  const text=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const scan=(n:ts.Node)=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='setAuthorizedDocumentArchived'){
   let parent:ts.Node|undefined=n.parent;while(parent&&!ts.isArrowFunction(parent)&&!ts.isFunctionDeclaration(parent))parent=parent.parent;
   while(parent&&!ts.isVariableDeclaration(parent)&&!ts.isFunctionDeclaration(parent))parent=parent.parent;
   const owner=parent&&(ts.isVariableDeclaration(parent)||ts.isFunctionDeclaration(parent))?parent.name?.getText(tree):undefined;
   callers.push(`${path.relative(ROOT,file)} ${owner??'(unnamed)'}`);
  }ts.forEachChild(n,scan);};scan(tree);
 }
 expect(callers).toEqual(['components/web-shell/desktop-auth-provider.tsx setDocumentArchived']);
});
