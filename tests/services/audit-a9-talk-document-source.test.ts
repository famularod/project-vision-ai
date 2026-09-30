/**
 * Whole-app audit A9 pass 1 #3 (30 Sep 2026): tapping a Talk answer's document
 * source cleared the answer and opened Document Evidence, which could only say
 * "The Ask ECOS citation is incomplete": Talk answers are local, so their
 * citations carry no project, source hash or evidence version. Closing that
 * sheet did not bring the answer back. Runs App.tsx's own
 * openTalkSupportingEvidence, compiled from the source.
 */
import { ecosDocumentProofClaimFromEvidence } from '../../services/ECOSDocumentProofAuthority';
import type { DAVEAskEvidence } from '../../services/DAVEAsk';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function declared at the given indent of App.tsx (component scope is two spaces), brace-matched. */
function appFunction(name: string, indent = ''): string {
  const match = new RegExp(`\\n${indent}(?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no function ${name}`);
  const start = match.index + 1;
  const open = app.indexOf(' {\n', start) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced function ${name}`);
}

type Button = { text: string; style?: string; onPress?: () => void };
type Harness = {
  open: (projectName: string, citation: DAVEAskEvidence) => void;
  alert: jest.Mock;
  setTalkAnswer: jest.Mock;
  openEvidence: jest.Mock;
  askFor: jest.Mock;
};

function harness(): Harness {
  const alert = jest.fn();
  const setTalkAnswer = jest.fn();
  const openEvidence = jest.fn(async () => undefined);
  const askFor = jest.fn();
  const deps: Record<string, unknown> = {
    Alert: { alert },
    ecosDocumentProofClaimFromEvidence,
    ecosDocumentEvidence: { openEvidence },
    ecosProjectQuestion: { askFor },
    talkAnswer: { projectName: 'Garage', question: 'What guardrail is required at the parking edge?', answer: {} },
    setTalkAnswer,
    projectIntelligenceForTalk: () => { throw new Error('a document source must not navigate'); },
  };
  const js = ts.transpileModule(
    `${appFunction('openTalkSupportingEvidence', '  ')}\nmodule.exports = { openTalkSupportingEvidence };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as { openTalkSupportingEvidence: Harness['open'] } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return { open: mod.exports.openTalkSupportingEvidence, alert, setTalkAnswer, openEvidence, askFor };
}

// The citation shape ECOSDocumentIntelligence builds for a Talk answer.
const talkSource: DAVEAskEvidence = {
  sourceType: 'document',
  recordId: 'drawing-a101',
  summary: 'Architectural drawings, Sheet A101',
  timelineEventId: null,
  excerpt: 'Provide galvanized steel guardrails at all open parking edges.',
  documentCitation: {
    documentId: 'drawing-a101', documentName: 'Architectural drawings', revision: '2',
    pageNumber: 3, sheetNumber: 'A101', regionId: 'a101-note-7', label: 'Architectural drawings, Sheet A101',
  },
};
const checkedSource: DAVEAskEvidence = {
  ...talkSource,
  documentCitation: {
    ...talkSource.documentCitation!,
    projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
    sourceSha256: 'a'.repeat(64),
    evidenceVersion: 'ecos-hosted-evidence/1.3',
  },
};

describe('a Talk document source (audit A9 pass 1 #3)', () => {
  it('without a proof claim keeps the answer, opens no evidence, and explains with Ask in Ask ECOS', () => {
    const h = harness();
    h.open('Garage', talkSource);
    expect(h.setTalkAnswer).not.toHaveBeenCalled();
    expect(h.openEvidence).not.toHaveBeenCalled();
    expect(h.alert).toHaveBeenCalledTimes(1);
    const buttons = h.alert.mock.calls[0][2] as Button[];
    expect(buttons.map(button => button.text)).toEqual(['Cancel', 'Ask in Ask ECOS']);
    expect(h.askFor).not.toHaveBeenCalled();
  });

  it('Ask in Ask ECOS closes the Talk answer and asks the same question for the same project', () => {
    const h = harness();
    h.open('Garage', talkSource);
    (h.alert.mock.calls[0][2] as Button[]).find(button => button.text === 'Ask in Ask ECOS')!.onPress!();
    expect(h.setTalkAnswer).toHaveBeenCalledWith(null);
    expect(h.askFor).toHaveBeenCalledWith('Garage', 'What guardrail is required at the parking edge?');
    expect(h.openEvidence).not.toHaveBeenCalled();
  });

  it('with a proof claim opens the proof and keeps the Talk answer to return to', () => {
    const h = harness();
    h.open('Garage', checkedSource);
    expect(h.openEvidence).toHaveBeenCalledWith(checkedSource);
    expect(h.setTalkAnswer).not.toHaveBeenCalled();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('the Talk answer hides while proof shows, so closing proof brings it back', () => {
    const sheet = app.slice(app.indexOf('<DAVEConversationAnswerSheet'));
    expect(sheet.slice(0, sheet.indexOf('/>'))).toContain(
      'visible={Boolean(talkAnswer) && !ecosDocumentEvidence.state}',
    );
  });
});
