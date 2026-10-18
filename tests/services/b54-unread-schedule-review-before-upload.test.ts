import fs from 'fs';
import path from 'path';
import ts from 'typescript';

// Execute the production selection/save/duplicate closures together. Only the
// native copy, durable disk and uploader I/O boundaries are synthetic here.
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
const tree = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map<string, string>();
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree));
  ts.forEachChild(node, collect);
}
collect(tree);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
type Card = { id: string; projectId: string; name: string; category: string; ownedFileId: string; localUri: string; status: string; mimeType: string; sizeBytes: number };
type Notice = { title: string; message: string; buttons?: Array<{ text: string; onPress?: () => void }> };
function device(options: { pendingDisk?: boolean; pendingUpload?: boolean; offline?: boolean; failDiskAt?: number; duplicate?: boolean; duplicateProject?: string } = {}) {
  const disk = deferred(), upload = deferred();
  const events: string[] = [], notices: Notice[] = [], reviews: unknown[] = [];
  const existing: Card[] = options.duplicate ? [{ id: 'existing-document', projectId: `project:${options.duplicateProject || 'First Project'}`, name: 'test.pdf', category: 'Schedule', ownedFileId: 'existing-owned', localUri: 'file:///owned/existing.pdf', status: 'uploaded', mimeType: 'application/pdf', sizeBytes: 100 }] : [];
  let records: Card[] = [...existing], writes = 0, created = 0;
  let owner = 'first-owner';
  const current = { current: [...existing] };
  const reviewCard = { current: null as { batchId: string; documentId: string } | null };
  const deps: Record<string, unknown> = {
    documentUploadRequest: null, setDocumentUploadRequest: () => undefined, projectDocumentsCurrentRef: current,
    projectDocuments: [...existing], referenceDocumentsCurrentRef: { current: [] },
    projectScheduleImportCardRef: reviewCard,
    bindProjectDocumentUploadToAccount: () => { const startedAs = owner; return () => owner === startedAs; },
    validateECOSMobileDrawingControls: () => ({ valid: true }),
    authorityProjectId: (name: string) => `project:${name}`,
    prepareScheduleImportFromAsset: async () => ({ id: 'review-1', nothingRead: true, message: 'No dated activities were read.' }),
    createProjectDocumentFromAsset: async (asset: { name: string }, context: { projectName: string; category: string }) => ({
      id: `document-${++created}`, projectId: `project:${context.projectName}`, name: asset.name, category: context.category,
      ownedFileId: `owned-${created}`, localUri: `file:///owned/${created}.pdf`, status: 'local', mimeType: 'application/pdf', sizeBytes: 100,
    }),
    persistProjectDocumentsImmediately: async (next: Card[]) => {
      writes += 1;
      if (options.pendingDisk) await disk.promise;
      if (writes === options.failDiskAt) throw new Error('Synthetic disk failure');
      records = next.map(card => ({ ...card })); events.push(`saved:${next[0].id}`);
    },
    setProjectDocuments: () => undefined,
    deleteOwnedProjectDocument: jest.fn(async () => undefined),
    reportStoragePersistenceFailure: jest.fn(),
    retryProjectDocumentUpload: async (id: string, provided?: Card) => {
      events.push(`upload:${id}`);
      if (options.pendingUpload) await upload.promise;
      current.current = current.current.map(card => card.id === id ? { ...card, status: options.offline ? 'failed' : 'uploaded' } : card);
      if (options.offline && provided) { notices.push({ title: 'Document upload not completed', message: 'No signal' }); events.push('upload-alert'); }
      events.push(`upload-ended:${id}`);
      return !options.offline;
    },
    setIncomingScheduleImportBatch: (batch: unknown) => { events.push('review'); reviews.push(batch); },
    setScheduleProjectFilter: () => undefined, setScreen: () => undefined,
    cancelScheduleImport: jest.fn(),
    Alert: { alert: (title: string, message: string, buttons?: Notice['buttons']) => { notices.push({ title, message, buttons }); events.push(`notice:${title}`); } },
  };
  const names = ['confirmDocumentProjectSelection', 'confirmAndAttachProjectDocument', 'saveProjectDocument', 'addProjectDocumentDurably', 'duplicateProjectDocumentForAsset'];
  for (const name of names) if (!functions.has(name)) throw Error(`Missing actual App closure ${name}`);
  const code = ts.transpileModule(names.map(name => functions.get(name)).join('\n') + '\nreturn { confirmDocumentProjectSelection };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  // Each confirmation receives the captured selection for that one operation.
  return {
    disk, upload, events, notices, reviews, current, reviewCard, saved: () => records, switchAccount: () => { owner = 'second-owner'; },
    choose: (text: string) => {
      const question = notices.find(notice => notice.title === 'Possible duplicate document');
      const button = question?.buttons?.find(choice => choice.text === text);
      if (!button?.onPress) throw Error(`No duplicate choice ${text}`);
      button.onPress();
    },
    async add(category = 'Schedule', projects = ['First Project']) {
      const values = { ...deps, documentUploadRequest: { asset: { uri: 'file:///picker/test.pdf', name: 'test.pdf' }, selected: new Set(projects), category, attachToDraft: false, areaId: null, updateId: null, drawingControls: {} } };
      const run = new Function(...Object.keys(values), code)(...Object.values(values)) as { confirmDocumentProjectSelection: () => Promise<void> };
      await run.confirmDocumentProjectSelection();
    },
  };
}
const flush = () => new Promise<void>(done => setImmediate(done));

it('5.30 opens an unread schedule review after the durable card, while its slow first upload is still pending', async () => {
  const phone = device({ pendingUpload: true });
  const operation = phone.add();
  try {
    await flush();
    expect(phone.saved()).toHaveLength(1);
    expect(phone.reviews).toHaveLength(1);
    expect(phone.events).not.toContain('upload-ended:document-1');
    expect(phone.notices).toEqual([]);
  } finally { phone.upload.resolve(); await operation; await flush(); }
});
it('5.30 opens the unread review without an initial offline upload alert interrupting it', async () => {
  const phone = device({ offline: true });
  await phone.add(); await flush();
  expect(phone.saved()).toHaveLength(1);
  expect(phone.reviews).toHaveLength(1);
  expect(phone.notices).toEqual([]);
  expect(phone.current.current[0].status).toBe('failed');
});
it('the unread schedule review still waits for durable disk completion', async () => {
  const phone = device({ pendingDisk: true, pendingUpload: true });
  const operation = phone.add();
  try {
    await flush();
    expect(phone.saved()).toEqual([]);
    expect(phone.reviews).toEqual([]);
    expect(phone.events.filter(event => event.startsWith('upload:'))).toEqual([]);
    phone.disk.resolve(); await flush();
    expect(phone.saved()).toHaveLength(1);
  } finally { phone.disk.resolve(); phone.upload.resolve(); await operation; await flush(); }
});
it('an ordinary document keeps its existing asked-upload failure notice', async () => {
  const phone = device({ offline: true });
  await phone.add('Other');
  expect(phone.saved()).toHaveLength(1);
  expect(phone.reviews).toEqual([]);
  expect(phone.notices.map(notice => notice.title)).toEqual(['Document upload not completed']);
});
it('two unread schedule cards are durably saved before the review, and uploads run sequentially after it opens', async () => {
  const phone = device({ pendingUpload: true });
  const operation = phone.add('Schedule', ['First Project', 'Second Project']);
  try {
    await flush();
    expect(phone.saved()).toHaveLength(2);
    expect(phone.reviews).toHaveLength(1);
    expect(phone.events).toEqual(['saved:document-1', 'saved:document-2', 'review', 'upload:document-1']);
  } finally { phone.upload.resolve(); await operation; await flush(); }
  expect(phone.events.slice(-3)).toEqual(['upload-ended:document-1', 'upload:document-2', 'upload-ended:document-2']);
});
it('a partial add retains and silently uploads its saved first copy, without opening an untrue schedule review', async () => {
  const phone = device({ failDiskAt: 2, offline: true });
  await phone.add('Schedule', ['First Project', 'Second Project', 'Third Project']); await flush();
  expect(phone.saved()).toHaveLength(1);
  expect(phone.reviews).toEqual([]);
  expect(phone.notices.map(notice => notice.title)).toEqual(['Some document copies were saved']);
  expect(phone.notices[0].message).toContain('Not attempted: Third Project.');
  expect(phone.events.filter(event => event.startsWith('upload:'))).toEqual(['upload:document-1']);
});
it('an account change during the durable save prevents this selection from starting deferred uploads as the new account', async () => {
  const phone = device({ pendingDisk: true });
  const operation = phone.add();
  await flush(); phone.switchAccount(); phone.disk.resolve(); await operation; await flush();
  expect(phone.events.filter(event => event.startsWith('upload:'))).toEqual([]);
});
it('an account change during the first deferred upload prevents the second upload from starting', async () => {
  const phone = device({ pendingUpload: true });
  const operation = phone.add('Schedule', ['First Project', 'Second Project']);
  await flush(); phone.switchAccount(); phone.upload.resolve(); await operation; await flush();
  expect(phone.events.filter(event => event.startsWith('upload:'))).toEqual(['upload:document-1']);
});
it('5.31 does not claim a saved duplicate or open the schedule review before the owner answers the question', async () => {
  const phone = device({ duplicate: true });
  const operation = phone.add();
  try {
    await flush();
    expect(phone.notices.map(notice => notice.title)).toContain('Possible duplicate document');
    expect(phone.saved().map(card => card.id)).toEqual(['existing-document']);
    expect(phone.reviews).toEqual([]);
    expect(phone.reviewCard.current).toBeNull();
  } finally { phone.choose('Cancel'); await operation; await flush(); }
});
it('5.31 Upload Anyway ties the review to the newly kept duplicate card, after that card is durable', async () => {
  const phone = device({ duplicate: true });
  const operation = phone.add(); await flush(); phone.choose('Upload Anyway'); await operation; await flush();
  expect(phone.saved()).toHaveLength(2);
  expect(phone.reviews).toHaveLength(1);
  expect(phone.reviewCard.current).toEqual({ batchId: 'review-1', documentId: 'document-1' });
  expect(phone.saved()[0].id).toBe('document-1');
});
it('5.31 Cancel leaves the original card and opens no saved review or upload for the rejected copy', async () => {
  const phone = device({ duplicate: true });
  const operation = phone.add(); await flush(); phone.choose('Cancel'); await operation; await flush();
  expect(phone.saved().map(card => card.id)).toEqual(['existing-document']);
  expect(phone.reviews).toEqual([]);
  expect(phone.events.filter(event => event.startsWith('upload:'))).toEqual([]);
});
it('5.31 the acknowledged duplicate still waits for durable disk before it owns a review', async () => {
  const phone = device({ duplicate: true, pendingDisk: true, pendingUpload: true });
  const operation = phone.add(); await flush(); phone.choose('Upload Anyway');
  try {
    await flush();
    expect(phone.saved().map(card => card.id)).toEqual(['existing-document']);
    expect(phone.reviews).toEqual([]);
    expect(phone.reviewCard.current).toBeNull();
    phone.disk.resolve(); await operation; await flush();
    expect(phone.reviews).toHaveLength(1);
    expect(phone.reviewCard.current?.documentId).toBe('document-1');
    expect(phone.events).not.toContain('upload-ended:document-1');
  } finally { phone.disk.resolve(); phone.upload.resolve(); await operation; await flush(); }
});
it('5.31 a duplicate record-save failure retains the original and never opens a saved review', async () => {
  const phone = device({ duplicate: true, failDiskAt: 1 });
  const operation = phone.add(); await flush(); phone.choose('Upload Anyway'); await operation;
  expect(phone.saved().map(card => card.id)).toEqual(['existing-document']);
  expect(phone.reviews).toEqual([]);
  expect(phone.notices.at(-1)?.title).toBe('Schedule review unavailable');
  expect(phone.events.filter(event => event.startsWith('upload:'))).toEqual([]);
});
it('5.31 an account changed while the question is open cannot keep the old copy or open the old review', async () => {
  const phone = device({ duplicate: true });
  const operation = phone.add(); await flush(); phone.switchAccount(); phone.choose('Upload Anyway'); await operation;
  expect(phone.saved().map(card => card.id)).toEqual(['existing-document']);
  expect(phone.reviews).toEqual([]);
  expect(phone.events.filter(event => event.startsWith('upload:'))).toEqual([]);
});
it('5.31 a later failed copy truthfully acknowledges the earlier durable Upload Anyway copy', async () => {
  const phone = device({ duplicate: true, failDiskAt: 2 });
  const operation = phone.add('Schedule', ['First Project', 'Second Project', 'Third Project']);
  await flush(); phone.choose('Upload Anyway'); await operation; await flush();
  expect(phone.saved().map(card => card.id)).toEqual(['document-1', 'existing-document']);
  expect(phone.reviews).toEqual([]);
  expect(phone.notices.at(-1)?.title).toBe('Some document copies were saved');
  expect(phone.notices.at(-1)?.message).toContain('“test.pdf” — First Project (waiting to upload).');
  expect(phone.notices.at(-1)?.message).toContain('Not attempted: Third Project.');
});
it('5.31 cancelling a later duplicate stops the review and remaining copies while retaining prior durable work', async () => {
  const phone = device({ duplicate: true, duplicateProject: 'Second Project' });
  const operation = phone.add('Schedule', ['First Project', 'Second Project', 'Third Project']);
  await flush(); phone.choose('Cancel'); await operation; await flush();
  expect(phone.saved().map(card => card.id)).toEqual(['document-1', 'existing-document']);
  expect(phone.reviews).toEqual([]);
  expect(phone.notices.at(-1)?.title).toBe('Schedule review cancelled');
  expect(phone.events.filter(event => event.startsWith('upload:'))).toEqual(['upload:document-1']);
});
