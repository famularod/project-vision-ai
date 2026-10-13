/**
 * Review pass 1, L12 (nit; caused by "Ask ECOS release evidence names the
 * answering code or is refused ..."). "A checkout that says it is archived
 * is refused" read only the first non-blank line of the checkout's
 * CANONICAL.md for the word "archived". Of six notices the reviewer tried,
 * four were judged wrongly: a title first with ARCHIVED on the second line,
 * "RETIRED", and an HTML comment first were ACCEPTED; a canonical checkout
 * whose first line mentions where the archived copy is was REFUSED.
 *
 * The whole notice is read now, and it fails closed: a checkout with a
 * CANONICAL.md is used only when the notice says plainly that this checkout
 * is the canonical one and nothing in it says it is archived or retired.
 * A checkout with no CANONICAL.md is used as before. Synthetic notices only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Verdict = Readonly<{ use: boolean; because: string }>;
const lib = () => jest.requireActual('../../scripts/ecos-ask-live-acceptance-lib') as {
  canonicalNoticeVerdict(notice: string): Verdict;
  runtimeRepoRoot(): string;
  RUNTIME_CONTRACT_FILES: readonly string[];
};
const judged = (notice: string) => lib().canonicalNoticeVerdict(notice).use ? 'used' : 'refused';

describe('L12: the reviewer\'s six notices', () => {
  it.each([
    ['says ARCHIVED on its first line', '# This repository is ARCHIVED. Do not edit it.\n\nCanonical: elsewhere\n', 'refused'],
    ['a canonical checkout', '# Canonical Ask ECOS runtime\n', 'used'],
    ['a title first, ARCHIVED on the second line (was: used)', '# Ask ECOS runtime\n\nARCHIVED. This copy no longer answers. The canonical runtime is elsewhere.\n', 'refused'],
    ['says RETIRED (was: used)', '# RETIRED\n\nThis repository was retired on 21 September.\n', 'refused'],
    ['an HTML comment first, then the archived notice (was: used)', '<!-- do not remove this notice -->\n# This repository is ARCHIVED. Do not edit it.\n', 'refused'],
    ['a canonical checkout whose first line says where the archived copy is (was: refused)',
      '# This is the canonical Ask ECOS runtime. The archived copy is in the old runtime folder.\n', 'used'],
  ])('%s', (_name, notice, expected) => {
    expect(judged(notice)).toBe(expected);
  });
});

describe('L12: other wordings that say the checkout is not the one to use', () => {
  it.each([
    'This repository has been archived.',
    'This repo is deprecated. Use the new one.',
    'The runtime in this folder is superseded.',
    'Status: archived',
    'STATUS = retired',
    '> **ARCHIVED** as of 21 September',
    '# Runtime\n\nThis checkout is no longer the canonical runtime.',
    '# Runtime\n\nThis repository is not canonical.',
    '# Runtime\n\nThis repository is read-only.',
    'This copy is obsolete.',
    '<!--\n# Canonical Ask ECOS runtime\n-->\n# Archived',
    '# Canonical Ask ECOS runtime\n\nThis repository is ARCHIVED.',
  ])('refused, and for that reason: %j', notice => {
    const verdict = lib().canonicalNoticeVerdict(notice);
    expect(verdict.use).toBe(false);
    // Not merely because it "does not say": the sentence shown names what the notice says.
    expect(verdict.because).toMatch(/^its CANONICAL\.md says it is archived or retired \(".+"\)$/);
  });
});

describe('L12: it fails closed', () => {
  it.each([
    ['a notice that only says where the canonical runtime is', '**Canonical Ask ECOS runtime: `/somewhere/else/runtime`**\n'],
    ['"Canonical: elsewhere"', 'Canonical: elsewhere\n'],
    ['a notice that mentions an archive without saying which copy this is', '# Runtime\n\nSee the archived copy for history.\n'],
    ['a notice that says nothing either way', '# Runtime notes\n\nBuild with the usual script.\n'],
    ['an empty notice', ''],
    ['a notice that is only a comment', '<!-- This is the canonical runtime -->\n'],
    ['"not archived", which is not the same as saying it is the canonical one', 'This repository is not archived.\n'],
  ])('%s is refused', (_name, notice) => {
    expect(judged(notice)).toBe('refused');
  });

  it.each([
    'This repository is the canonical Ask ECOS runtime.',
    'This checkout is canonical.',
    'Status: canonical',
    '# Canonical runtime\n\nThe archived copy must not be edited or deployed.',
    '<!-- notice -->\n\n**This is the canonical runtime.**',
  ])('used, because it says plainly that it is the canonical one: %j', notice => {
    expect(judged(notice)).toBe('used');
  });

  it('the reason is given in a sentence, with the line it turned on', () => {
    expect(lib().canonicalNoticeVerdict('# Ask ECOS runtime\n\nARCHIVED. This copy no longer answers.\n')).toEqual({
      use: false,
      because: 'its CANONICAL.md says it is archived or retired ("ARCHIVED. This copy no longer answers.")',
    });
    expect(lib().canonicalNoticeVerdict('Canonical: elsewhere\n')).toEqual({
      use: false,
      because: 'its CANONICAL.md says the canonical runtime is somewhere else ("Canonical: elsewhere")',
    });
    expect(lib().canonicalNoticeVerdict('# Runtime notes\n')).toEqual({
      use: false,
      because: 'its CANONICAL.md does not say plainly that this checkout is the canonical one. If it is, add the line "Status: canonical" to that file',
    });
  });
});

describe('L12: through the door release evidence uses', () => {
  const named = process.env.ECOS_RUNTIME_REPO;
  let checkout = '';
  beforeEach(() => {
    checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'e2-l12-runtime-'));
    for (const file of lib().RUNTIME_CONTRACT_FILES) {
      fs.mkdirSync(path.dirname(path.join(checkout, file)), { recursive: true });
      fs.writeFileSync(path.join(checkout, file), '// stand-in; not the answering code\n');
    }
    process.env.ECOS_RUNTIME_REPO = checkout;
  });
  afterEach(() => {
    fs.rmSync(checkout, { recursive: true, force: true });
    if (named === undefined) delete process.env.ECOS_RUNTIME_REPO;
    else process.env.ECOS_RUNTIME_REPO = named;
  });
  const notice = (contents: string) => fs.writeFileSync(path.join(checkout, 'CANONICAL.md'), contents);

  it('a checkout with no CANONICAL.md is used, as before', () => {
    expect(lib().runtimeRepoRoot()).toBe(checkout);
  });

  it('a title first with ARCHIVED on the second line is refused, and the sentence quotes the line (was: used)', () => {
    notice('# Ask ECOS runtime\n\nARCHIVED. This copy no longer answers.\n');
    expect(() => lib().runtimeRepoRoot()).toThrow(
      /cannot be used for release evidence: its CANONICAL\.md says it is archived or retired \("ARCHIVED\. This copy no longer answers\."\)\. Set ECOS_RUNTIME_REPO to the canonical runtime checkout/,
    );
  });

  it('a canonical checkout that mentions the archived copy is used (was: refused)', () => {
    notice('# This is the canonical Ask ECOS runtime. The archived copy is in the old runtime folder.\n');
    expect(lib().runtimeRepoRoot()).toBe(checkout);
  });

  it('a CANONICAL.md that cannot be read is refused', () => {
    fs.mkdirSync(path.join(checkout, 'CANONICAL.md'));
    expect(() => lib().runtimeRepoRoot()).toThrow(/cannot be used for release evidence: its CANONICAL\.md could not be read/);
  });
});
