/**
 * Build 231 E1 item 7 (from the R03 / R04 check). Two things:
 *
 * 1. The script that stamps Ask ECOS release evidence took "the deployed
 *    runtime" from the folder next to this repository when ECOS_RUNTIME_REPO
 *    was not set. That folder is the archived runtime, so evidence made with
 *    the defaults named the wrong server build. It now names the checkout
 *    ECOS_RUNTIME_REPO points at, or refuses.
 * 2. Scripts and tests still read this repository's archived copy of the Ask
 *    ECOS function. They stay, and each says the copy is not the live service.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '../..');
const ARCHIVED_COPY = '_archived-ecos-ask-project-not-live';
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

/** Runs one of the repository's offline node scripts with no runtime checkout named. */
function runScript(relativePath: string) {
  const env = { ...process.env };
  delete env.ECOS_RUNTIME_REPO;
  const result = spawnSync(process.execPath, [path.join(root, relativePath)], { cwd: root, env, encoding: 'utf8' });
  return { status: result.status, lines: `${result.stdout}`.trim().split('\n'), stderr: `${result.stderr}` };
}

function filesMentioning(text: string, folder: string): string[] {
  return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
    const relativePath = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesMentioning(text, relativePath);
    return /\.(js|ts|tsx|json|sh|yml|mjs)$/.test(entry.name) && read(relativePath).includes(text) ? [relativePath] : [];
  });
}

describe('E1 item 7: Ask ECOS release evidence names the answering code, or is refused', () => {
  const lib = () => jest.requireActual('../../scripts/ecos-ask-live-acceptance-lib') as {
    CONTRACT_FILES: readonly string[];
    runtimeRepoRoot(): string;
    acceptanceContractHash(): string;
  };
  const named = process.env.ECOS_RUNTIME_REPO;
  afterEach(() => {
    if (named === undefined) delete process.env.ECOS_RUNTIME_REPO;
    else process.env.ECOS_RUNTIME_REPO = named;
  });

  it('has no default runtime folder: with ECOS_RUNTIME_REPO not set it refuses (was: read ../runtime, the archived runtime)', () => {
    delete process.env.ECOS_RUNTIME_REPO;
    expect(() => lib().runtimeRepoRoot()).toThrow(/ECOS_RUNTIME_REPO is not set/);
    expect(() => lib().acceptanceContractHash()).toThrow(/never against a default folder/);
    expect(read('scripts/ecos-ask-live-acceptance-lib.js')).not.toMatch(/path\.resolve\(repoRoot, '\.\.', 'runtime'\)/);
  });

  it('does not stamp evidence against this repository\'s archived copy of the function', () => {
    expect(lib().CONTRACT_FILES.filter(file => file.includes('_archived-'))).toEqual([]);
    expect(read('scripts/ecos-ask-live-acceptance-lib.js')).not.toContain(`'supabase/functions/${ARCHIVED_COPY}/index.ts'`);
  });

  it.each([
    'scripts/ecos-ask-live-acceptance-test.js',
    'scripts/ecos-ask-2321-live-acceptance-test.js',
  ])('%s passes with no runtime checkout beside the repository (as on GitHub), and leaves no evidence file', script => {
    const evidence = path.join(root, 'validation/output/ecos-ask-live-acceptance.json');
    const evidenceBefore = fs.existsSync(evidence);
    const run = runScript(script);
    expect([run.status, run.stderr]).toEqual([0, '']);
    expect(run.lines.some(line => /acceptance contracts PASS/.test(line))).toBe(true);
    expect(fs.existsSync(evidence)).toBe(evidenceBefore);
  });

  it('the offline evidence test covers the refusals and the cross-check with what the live service says answered', () => {
    const test = read('scripts/ecos-ask-live-acceptance-test.js');
    for (const covered of [
      '/ECOS_RUNTIME_REPO is not set/',
      'says it is archived',
      'did not say which Ask ECOS package answered',
      'answered with package',
      'could not be checked against the answering code',
    ]) {
      expect(test).toContain(covered);
    }
    // The stamping script records it from each live answer and the check reads it.
    expect(read('scripts/ecos-ask-live-acceptance.js')).toMatch(/onAnswered: answered => answeringPackages\.add\(answeringPackageOf\(answered\)\)/);
    expect(read('scripts/ecos-ask-live-acceptance.js')).toMatch(/\n    answeringPackageSha256s,\n/);
    expect(read('scripts/ecos-ask-live-acceptance-lib.js')).toMatch(/answeringPackageFailures\(result\?\.answeringPackageSha256s, pinnedPackageSha256\)/);
  });
});

describe('E1 item 7: nothing that reads the archived copy of the Ask ECOS function can be taken for a check of the live service', () => {
  const SCRIPTS = [
    'scripts/ecos-hosted-indexer-contract-test.js',
    'scripts/ecos-project-question-contract-test.js',
    'scripts/ecos-unified-reliability-contract-test.js',
  ];
  const TESTS = [
    'tests/services/ecos-ask-legacy-drawing-boundary.test.ts',
    'tests/services/ecos-project-question.test.ts',
    'tests/services/independent-review-r04-old-ask-function-not-deployable.test.ts',
  ];
  const THIS_TEST = 'tests/services/e1-b7-ask-evidence-names-answering-code.test.ts';

  it('the readers are these and no others', () => {
    const readers = ['scripts', 'tests', 'services', 'hooks', 'components', '.github']
      .flatMap(folder => filesMentioning(ARCHIVED_COPY, folder))
      .concat(read('package.json').includes(ARCHIVED_COPY) ? ['package.json'] : []);
    expect(readers.sort()).toEqual([...SCRIPTS, ...TESTS, THIS_TEST].sort());
  });

  it.each(SCRIPTS)('%s says so where it reads the copy, and in the last line it prints', script => {
    const source = read(script);
    const readAt = source.indexOf(`read('supabase/functions/${ARCHIVED_COPY}/index.ts')`);
    expect(source.slice(Math.max(0, readAt - 400), readAt)).toContain('// NOT THE LIVE SERVICE');
    const run = runScript(script);
    expect(run.status).toBe(0);
    expect(run.lines[run.lines.length - 1]).toBe(
      `NOTE: every check of the Ask ECOS function above read supabase/functions/${ARCHIVED_COPY}/index.ts, ` +
      "this repository's archived copy, which is not deployed. Those checks say nothing about the live Ask ECOS service.",
    );
  });

  // Guard: these already hold on 594a71d.
  it.each(TESTS)('%s names the copy as archived or not live in the test that reads it', test => {
    const source = read(test);
    const names = [...source.matchAll(/\b(?:describe|it)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g)].map(match => match[2]);
    expect(names.some(name => /not live|cannot be deployed over the live/i.test(name))).toBe(true);
  });
});
