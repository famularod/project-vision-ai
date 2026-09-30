import fs from 'node:fs';
import path from 'node:path';

describe('mobile project-document continuity contract', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const documentCardSource = fs.readFileSync(
    path.join(process.cwd(), 'components/project-document-card.tsx'),
    'utf8',
  );

  it('carries validated drawing metadata into the pre-upload local record', () => {
    expect(source).toContain('validateECOSMobileDrawingControls(drawingControls)');
    expect(source).toContain('mobileDrawingMetadataForUpload(drawingControls, replacementDocument)');
    expect(source).toContain("...(context?.category === 'Drawing' ? context.drawingMetadata : null)");
  });

  // The shared record is queued through the debounced lifecycle, not at every
  // keystroke (whole-app audit A8 pass 1 F1, 30 Sep 2026): typed text once
  // typing pauses, a chip tap at once, the latest record when it fires.
  it('mirrors later metadata edits into the queued shared ECOS record', () => {
    expect(source).toContain('synchronizeSharedReferenceDocumentMetadata({');
    expect(source).toContain('projectDocumentSharedRecordSync.queueAfterChange(synchronizedDocument.id, next);');
    expect(source).not.toContain('void queueReferenceDocumentRecord(synchronizedDocument)');
    expect(source).toContain('const latest = referenceDocumentsCurrentRef.current.find(document => document.id === documentId);\n    if (latest) void queueReferenceDocumentRecord(latest);');
  });

  // The transaction moved into services/SharedDocumentActivation.ts and now
  // serves schedules too (whole-app audit A5 F4, 30 Sep 2026): a schedule has
  // no ECOS preparation gate, and a conflict is retried once.
  const activationSource = fs.readFileSync(
    path.join(process.cwd(), 'services/SharedDocumentActivation.ts'),
    'utf8',
  );

  it('uses the shared readiness card and one server-owned Make Current transaction', () => {
    expect(documentCardSource).toContain('<MobileDocumentECOSStatus');
    expect(source).toContain('onMakeCurrentDocument={markReferenceDocumentCurrent}');
    expect(source).toContain('const readiness = buildECOSDocumentReadiness(target)');
    expect(source).toContain("canonicalReferenceCategory(target) !== 'schedule' && !readiness.canMakeCurrent");
    expect(source).toContain('await activateSharedReferenceDocument({');
    expect(activationSource).toContain('expectedUpdatedAt: target.cloudUpdatedAt');
    expect(activationSource).toContain('activate = activateECOSCurrentReferenceDocument');
    expect(source).toContain('const result = await listReferenceDocuments()');
  });

  it('does not optimistically queue independent current-revision record writes', () => {
    const workflow = source.match(
      /async function activateReferenceDocument[\s\S]+?\n  async function ensureVerifiedReferenceDocumentBytes/,
    )?.[0] || '';
    expect(workflow).toContain('function markReferenceDocumentCurrent');
    expect(workflow).not.toContain('markAuthoritativeDocumentCurrent');
    expect(workflow).not.toContain('unmarkAuthoritativeDocumentCurrent');
    expect(workflow).not.toContain('queueReferenceDocumentRecord');
    expect(workflow).not.toContain('Promise.all');
  });

  it('makes a shared schedule current through the same transaction from both screens', () => {
    const setActive = source.match(
      /function setActiveScheduleDocument\(documentId: string\) \{[\s\S]+?\n  \}\n/,
    )?.[0] || '';
    expect(setActive).toContain('markReferenceDocumentCurrent(documentId)');
    expect(setActive).not.toContain('queueReferenceDocumentRecord');
    expect(setActive).not.toContain('isCurrent');
    expect(source).toContain(
      'if (alreadyShared && !(await activateReferenceDocument(selectedReferenceDocument.id))) return;',
    );
    expect(source).toContain('    if (alreadyShared) return;\n    referenceDocumentsCurrentRef.current = nextReferenceDocuments;');
  });

  // Whole-app audit A8 pass 1 F6 (30 Sep 2026): a schedule with no imported
  // tasks, made current, hid the project's tasks on every device unasked. The
  // question comes before the shared path (cloud activation) and the path
  // that shares the PDF first. Both functions run here, compiled from App.tsx.
  describe('Make Current on a phone schedule with no imported tasks', () => {
    const ts = jest.requireActual('typescript') as typeof import('typescript');
    const activation = jest.requireActual('../../services/SharedDocumentActivation') as typeof import('../../services/SharedDocumentActivation');
    const slice = (from: string, to: string) => {
      const start = source.indexOf(`\n  ${from}`) + 1;
      const end = source.indexOf(`\n  ${to}`, start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    };
    const master = {
      id: 'master', name: 'Alpha master', originalFileName: 'Alpha master.pdf', uri: '', category: 'Schedules',
      notes: '', isCurrent: true, importedAt: '2026-09-01T00:00:00.000Z', projectName: 'Alpha', importBatchId: 'batch-master',
    };
    const task = (id: string) => ({
      id, projectName: 'Alpha', taskName: `Task ${id}`, locationName: 'Lot', owner: '', startDate: '07/01/2026',
      finishDate: '07/10/2026', milestone: '', status: 'Not Started', percentComplete: 0, notes: '',
      createdAt: '2026-07-01T00:00:00.000Z', sourceDocumentId: 'master', importBatchId: 'batch-master',
    });
    const phonePdf = (referenceDocumentId: string | null) => ({
      id: 'phone-pdf', projectId: 'alpha-key', name: 'Alpha rev 5.pdf', category: 'Schedule', mimeType: 'application/pdf',
      sizeBytes: 10, referenceDocumentId, importedAt: '2026-09-20T00:00:00.000Z',
    });
    const sharedPdf = { ...master, id: 'shared-pdf', name: 'Alpha rev 5', isCurrent: false, importBatchId: null, importedAt: '2026-09-20T00:00:00.000Z' };

    function load(document: ReturnType<typeof phonePdf>, answer: string) {
      const alerts: Array<{ title: string; message: string; buttons: string[] }> = [];
      const deps: Record<string, unknown> = {
        projectDocuments: [document], projects: ['Alpha'], authorityProjectId: () => 'alpha-key',
        referenceDocuments: [master, sharedPdf], scheduleItems: [task('a1'), task('a2')],
        scheduleTasksHiddenWarning: activation.scheduleTasksHiddenWarning,
        scheduleTasksHiddenByActivation: activation.scheduleTasksHiddenByActivation,
        phoneScheduleActivationTarget: activation.phoneScheduleActivationTarget,
        // Owner answer Q15: the phone asks how the cloud retires schedules first; this is the database before that migration.
        loadECOSScheduleRetirementScope: jest.fn(async () => 'schedule'), getSupabaseClient: () => null,
        activateReferenceDocument: jest.fn(async () => false),
        ensureVerifiedProjectDocumentBytes: jest.fn(async (verified: object) => ({ ...verified, localUri: 'file:///verified/alpha-rev-5.pdf' })),
        prepareScheduleImportFromAsset: jest.fn(async () => ({ id: 'batch' })),
        setIncomingScheduleImportBatch: jest.fn(), setScheduleProjectFilter: jest.fn(), setScreen: jest.fn(),
        ensureReferenceDocumentsDirectory: jest.fn(async () => { throw new Error('stop here'); }),
        Alert: { alert: (title: string, message: string, buttons?: Array<{ text: string; onPress?: () => void }>) => {
          alerts.push({ title, message, buttons: (buttons || []).map(button => button.text) });
          buttons?.find(button => button.text === answer)?.onPress?.();
        } },
      };
      const body = `${slice('async function makeProjectScheduleDocumentCurrent(', 'async function reviewProjectScheduleDocumentImport(')}\n` +
        `${slice('async function reviewProjectScheduleDocumentImport(', 'function deleteProjectDocument(')}\n` +
        'module.exports = { makeProjectScheduleDocumentCurrent };';
      const js = ts.transpileModule(body, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const mod = { exports: {} as { makeProjectScheduleDocumentCurrent: (documentId: string) => Promise<void> } };
      new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
      return { make: mod.exports.makeProjectScheduleDocumentCurrent, alerts, deps };
    }
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const warning = {
      title: 'Make Alpha rev 5.pdf current?',
      message: 'Alpha rev 5.pdf has no imported tasks. The 2 tasks from Alpha master will be hidden on every device.',
      buttons: ['Cancel', 'Import This Schedule', 'Make Current'],
    };

    it.each([
      ['already shared, through cloud activation', 'shared-pdf', 'activateReferenceDocument'],
      ['not shared yet, shared first', null, 'ensureVerifiedProjectDocumentBytes'],
    ])('%s: asks first, and Cancel changes nothing', async (_path, referenceDocumentId, pathStep) => {
      const { make, alerts, deps } = load(phonePdf(referenceDocumentId), 'Cancel');
      await make('phone-pdf');
      await settle();
      expect(alerts).toEqual([warning]);
      expect(deps[pathStep]).not.toHaveBeenCalled();
      expect(deps.activateReferenceDocument).not.toHaveBeenCalled();
      expect(deps.ensureVerifiedProjectDocumentBytes).not.toHaveBeenCalled();
    });

    it.each([
      ['already shared, through cloud activation', 'shared-pdf', 'activateReferenceDocument'],
      ['not shared yet, shared first', null, 'ensureVerifiedProjectDocumentBytes'],
    ])('%s: Make Current goes ahead once, without asking again', async (_path, referenceDocumentId, pathStep) => {
      const { make, alerts, deps } = load(phonePdf(referenceDocumentId), 'Make Current');
      await make('phone-pdf');
      await settle();
      expect(alerts[0]).toEqual(warning);
      expect(alerts.filter(alert => alert.title === warning.title)).toHaveLength(1);
      expect(deps[pathStep]).toHaveBeenCalledTimes(1);
    });

    it('Import This Schedule sends the verified file to the schedule import review and makes nothing current', async () => {
      const { make, deps } = load(phonePdf('shared-pdf'), 'Import This Schedule');
      await make('phone-pdf');
      await settle();
      expect(deps.prepareScheduleImportFromAsset).toHaveBeenCalledWith(
        { uri: 'file:///verified/alpha-rev-5.pdf', name: 'Alpha rev 5.pdf', mimeType: 'application/pdf', size: 10 },
        ['Alpha'],
      );
      expect(deps.setIncomingScheduleImportBatch).toHaveBeenCalledWith({ id: 'batch' });
      expect(deps.setScreen).toHaveBeenCalledWith('Schedule');
      expect(deps.activateReferenceDocument).not.toHaveBeenCalled();
    });

    it('asks nothing when the schedule brings tasks of its own', async () => {
      const { make, alerts, deps } = load(phonePdf('shared-pdf'), 'Cancel');
      (deps.scheduleItems as Array<Record<string, unknown>>).push({ ...task('a3'), sourceDocumentId: 'shared-pdf', importBatchId: null });
      await make('phone-pdf');
      await settle();
      expect(alerts).toEqual([]);
      expect(deps.activateReferenceDocument).toHaveBeenCalledTimes(1);
    });
  });
});
