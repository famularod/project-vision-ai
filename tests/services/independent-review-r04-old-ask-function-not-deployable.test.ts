// Independent review of Build 229, R03 / R04: the review read this repository's
// old `ecos-ask-project` function as if it were the live service. The live
// function of that name is a forwarder deployed from the runtime repository
// (read back on 30 Sep and 5 Oct 2026). Deploying this repository's old copy
// under that name would replace it, so the copy is kept where it cannot be.
import fs from 'node:fs';
import path from 'node:path';

import { ECOS_PROJECT_QUESTION_FUNCTION } from '../../services/ECOSQuestionProtocol';

const functionsDir = path.join(__dirname, '../../supabase/functions');
const archivedDir = '_archived-ecos-ask-project-not-live';
// The rule the review criticised: a statement counted as supported when a
// quarter of its words appeared anywhere in the cited sources.
const OLD_OVERLAP_RULE = 'matched.length / claimWords.length >= 0.25';
// A function is deployed under its folder's name, which must start with a letter.
const DEPLOYABLE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

describe('the old Ask ECOS function cannot be deployed over the live forwarder', () => {
  const folders = fs.readdirSync(functionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

  it('the app still asks the function the live forwarder answers under', () => {
    expect(ECOS_PROJECT_QUESTION_FUNCTION).toBe('ecos-ask-project');
  });

  it('has no folder under that name in this repository', () => {
    expect(folders).not.toContain(ECOS_PROJECT_QUESTION_FUNCTION);
    expect(folders.filter(name => name.toLowerCase() === ECOS_PROJECT_QUESTION_FUNCTION)).toEqual([]);
  });

  it('keeps the old copy under a name that is not a function name, and says so on its first line', () => {
    expect(folders).toContain(archivedDir);
    expect(archivedDir).not.toMatch(DEPLOYABLE_NAME);
    const source = fs.readFileSync(path.join(functionsDir, archivedDir, 'index.ts'), 'utf8');
    expect(source.startsWith('// NOT LIVE. ARCHIVED COPY. DO NOT DEPLOY.\n')).toBe(true);
    // It is still the file the review read.
    expect(source).toContain(OLD_OVERLAP_RULE);
  });

  it('no deployable function folder holds the old word-overlap rule', () => {
    const deployable = folders.filter(name => DEPLOYABLE_NAME.test(name));
    expect(deployable.length).toBeGreaterThan(0);
    for (const name of deployable) {
      const files = fs.readdirSync(path.join(functionsDir, name)).filter(file => file.endsWith('.ts'));
      for (const file of files) {
        const source = fs.readFileSync(path.join(functionsDir, name, file), 'utf8');
        expect({ function: name, file, hasOldRule: source.includes(OLD_OVERLAP_RULE) })
          .toEqual({ function: name, file, hasOldRule: false });
      }
    }
  });
});
