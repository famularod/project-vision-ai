/** Executes the actual producer closures from the source AST with synthetic IO.
 * No app/provider mount, account access or live file/network IO. */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { reportFileTitleWithDate, reportSubjectWithDate, mailComposerOutcome } from '../../services/ReportCommunication';
function producer(file: string, name: string, deps: Record<string, unknown>) {
  const text=fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
  const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let found: ts.Node | undefined;
  const visit=(node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree)===name) found=node;
    ts.forEachChild(node,visit);
  };
  visit(tree);
  if (!found) throw new Error(name);
  const node=found as ts.FunctionDeclaration | ts.VariableDeclaration;
  const expression=ts.isVariableDeclaration(node) ? node.initializer!.getText(tree) : node.getText(tree);
  const code=ts.transpileModule(`const extracted = ${expression};`, { compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS} }).outputText;
  return new Function(...Object.keys(deps),`${code}; return extracted;`)(...Object.values(deps));
}
const oneAtATime=async (values: unknown[], fn: (v: unknown)=>Promise<unknown>)=>Promise.all(values.map(fn));
const report={title:'.工程🏗️'.repeat(100),subject:'Tower',body:'Exact approved words. Image 3.',generatedAt:'2026-10-16T12:00:00',daveBriefing:{wordTaskLines:['3. Exact task']},locationGroups:[]};
afterEach(()=>jest.useRealTimers());
beforeEach(()=>jest.useFakeTimers({now:new Date(2026,9,17,12),doNotFake:['nextTick','setImmediate','setTimeout']}));
describe('7.23 actual report producers',()=>{
  it('native Word/Outlook share uses a visible bounded action-day file and exact body/title/task numbering',async()=>{
    const write=jest.fn(async(..._args: unknown[])=>undefined), share=jest.fn(async()=>undefined), build=jest.fn(async()=> 'fake base64');
    const fn=producer('App.tsx','shareWordReport',{
      sanitizeFilename:producer('App.tsx','sanitizeFilename',{}), Sharing:{isAvailableAsync:async()=>true,shareAsync:share},Alert:{alert:jest.fn()},
      FileSystem:{cacheDirectory:'file:///cache/',writeAsStringAsync:write,deleteAsync:async()=>undefined,EncodingType:{Base64:'base64'}},
      reportBodyCitesImages:()=>false,activeSavedUpdates:[],oneAtATime,
      resolveNativeReportWordMedia:async()=>({media:[],unavailableMedia:[]}),reportFileTitleWithDate,
      require:()=>({buildReportWordBase64:build,summarizeReportWordUnavailableMedia:()=>''}),
    });
    expect(await fn(report,[],'Outlook')).toBe(true);
    const filename=write.mock.calls[0][0] as unknown as string;
    expect(filename).toMatch(/2026-10-17\.docx$/);
    expect(filename.slice('file:///cache/'.length)).not.toMatch(/^\./);
    expect(Buffer.byteLength(filename.slice('file:///cache/'.length))).toBeLessThanOrEqual(240);
    expect(build).toHaveBeenCalledWith(expect.objectContaining({title:report.title,body:report.body,generatedAt:report.generatedAt,taskLines:report.daveBriefing.wordTaskLines}));
    expect(share).toHaveBeenCalledWith(filename,expect.objectContaining({dialogTitle:'Outlook'}));
  });
  it('desktop Word download keeps its original body/date/numbering while dating the download today',async()=>{
    const download=jest.fn(),build=jest.fn(async()=>({synthetic:'blob'}));
    const fn=producer('components/web-shell/desktop-read-only-shell.tsx','downloadWordReport',{
      safeDownloadName:producer('components/web-shell/desktop-read-only-shell.tsx','safeDownloadName',{}),pending:false,REPORT_PERIOD_WAITING_LINE:'Not counted yet',setWordHeldBack:jest.fn(),setPending:jest.fn(),setNotice:jest.fn(),
      snapshot:{projectUpdates:[],referenceDocuments:[],scheduleItems:[]},uniqueStrings:(v:unknown)=>v,
      buildAutomaticReportDrawingReferences:()=>[],referenceDocumentsCitedAsListed:(v:unknown)=>v,selectedProjectNames:[],
      resolveWebReportWordMedia:async()=>({media:[],unavailableMedia:[]}),auth:{getArtifactUrl:jest.fn()},
      briefing:{wordTaskLines:report.daveBriefing.wordTaskLines},reportFileTitleWithDate,downloadBlob:download,
      require:()=>({buildReportWordBlob:build,summarizeReportWordUnavailableMedia:()=>''}),
    });
    await fn({...report,updateIds:[]});
    expect(download).toHaveBeenCalledWith(expect.stringMatching(/2026-10-17\.docx$/),{synthetic:'blob'});
    expect(Buffer.byteLength(download.mock.calls[0][0])).toBeLessThanOrEqual(240);
    expect(build).toHaveBeenCalledWith(expect.objectContaining({title:report.title,body:report.body,generatedAt:report.generatedAt,taskLines:report.daveBriefing.wordTaskLines}));
  });
  it('desktop email dates the approved draft on action day and still refuses unapproved text',async()=>{
    const open=jest.fn(),question=jest.fn();
    const deps={reportStatus:'approved',window:{open},draftSaysNotCounted:false,approvedPeriodMoved:false,
      sendCheckStands:()=>true,reportAsShared:()=>({id:'approved'}),reportSubjectWithDate,
      reportTitle:'Tower',reportGeneratedAt:report.generatedAt,reportBody:report.body,
      prepareDAVEWebReportEmailBody:(text:string)=>({text,shortened:false}),sentFromHereAt:null,setNotice:jest.fn(),setSendQuestion:question};
    const file='components/web-shell/desktop-read-only-shell.tsx';
    await producer(file,'prepareApprovedReportEmail',deps)();
    expect(open).toHaveBeenCalledWith(`mailto:?subject=${encodeURIComponent('Tower — Oct 17, 2026')}&body=${encodeURIComponent(report.body)}`,'_blank','noopener,noreferrer');
    expect(question).toHaveBeenCalledWith({id:'approved'});
    open.mockClear();
    await producer(file,'prepareApprovedReportEmail',{...deps,reportStatus:'draft'})();
    expect(open).not.toHaveBeenCalled();
  });
  it.each(['sent','cancelled','undetermined'])('native Mail preserves body and composer outcome %s',async status=>{
    const compose=jest.fn(async()=>({status}));
    const fn=producer('App.tsx','emailReport',{
      MailComposer:{isAvailableAsync:async()=>true,composeAsync:compose},reportImageFiles:async()=>({photos:[],note:''}),
      reportBodyCitesImages:()=>false,REPORT_EMAIL_IMAGE_LIMIT:10,reportSubjectWithDate,reportEmailRecipients:()=>['synthetic@example.invalid'],mailComposerOutcome,
    });
    expect(await fn(report)).toBe(mailComposerOutcome(status));
    expect(compose).toHaveBeenCalledWith(expect.objectContaining({subject:'Tower — Oct 17, 2026',body:report.body}));
  });
});
