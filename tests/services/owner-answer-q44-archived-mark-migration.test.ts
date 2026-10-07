/**
 * Owner answer Q44 (6 Oct 2026): the database change behind "archived =
 * hidden on every device, kept in the cloud". The owner pastes it himself, so
 * what it may and may not do is pinned here, to the letter: it adds two empty
 * columns in one statement, in one transaction, safe to run twice, and it
 * deletes or rewrites nothing.
 *
 * The two columns: archived_at, the mark the app sets and empties; and
 * archive_version, a whole-number counter for a later app build (the third
 * review's recommendation, 7 Oct 2026). The app does not read or write the
 * counter yet. It is added now, empty, so that the owner has one database
 * change to paste and not two.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const TABLE = 'public.reference_documents';
/** The one statement that changes the table, as it must read (each statement on one line, single-spaced). */
const ADD_BOTH_COLUMNS = `alter table ${TABLE} add column if not exists archived_at timestamptz, add column if not exists archive_version integer`;

/** The statements themselves: comment lines and the comment text in quotes are not instructions. */
let statements = '';
/** The notes the change puts on the columns: the text in quotes, in the order written. */
let notes: string[] = [];
beforeEach(() => {
  const withoutCommentLines = readFileSync(join(__dirname, '../../supabase/migrations/20261006120000_reference_document_archived_mark.sql'), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  notes = (withoutCommentLines.match(/'[^']*'/g) ?? []).map(text => text.slice(1, -1));
  statements = withoutCommentLines
    .replace(/'[^']*'/g, "''")
    .toLowerCase();
});

/** Every statement of the file, in order, each on one line and single-spaced. */
const statementList = () => statements.split(';').map(part => part.trim().replace(/\s+/g, ' ')).filter(Boolean);

describe('the archived-mark database change (owner answer Q44)', () => {
  it('adds the two columns, both empty, in one statement that can be run twice', () => {
    // One "alter table", so the table is asked for once: both columns arrive together or neither does.
    expect(statementList().filter(statement => statement.startsWith('alter'))).toEqual([ADD_BOTH_COLUMNS]);
    // As it is written in the file the owner's paste is copied from.
    expect(statements).toContain(`alter table ${TABLE}\n  add column if not exists archived_at timestamptz,\n  add column if not exists archive_version integer;`);
    // Exactly these two, and each skipped if it is already there (a second run).
    expect(statements.match(/\badd\b/g)).toHaveLength(2);
    expect(statements.match(/\badd column if not exists\b/g)).toHaveLength(2);
    // No default and no "not null", on either: every existing document starts not archived, with an empty counter,
    // and no row is rewritten. A write that names neither column (every build's save of a document) is never refused.
    expect(statements).not.toMatch(/\bdefault\b/);
    expect(statements).not.toMatch(/\bnot\s+null\b/);
    for (const more of [/\bcheck\b/, /\bunique\b/, /\breferences\b/, /\bprimary\b/, /\bgenerated\b/, /\bconstraint\b/, /\bindex\b/, /\busing\b/]) {
      expect(statements).not.toMatch(more);
    }
  });

  it('is one transaction', () => {
    expect(statements.trim().startsWith('begin;')).toBe(true);
    expect(statements.trim().endsWith('commit;')).toBe(true);
    expect(statements.match(/\bbegin;/g)).toHaveLength(1);
    expect(statements.match(/\bcommit;/g)).toHaveLength(1);
  });

  it('deletes nothing, rewrites nothing, and touches no rule, trigger or function', () => {
    for (const forbidden of [
      /\bdrop\b/, /\bdelete\b/, /\btruncate\b/, /\bupdate\b/, /\binsert\b/,
      /\bpolicy\b/, /\btrigger\b/, /\bfunction\b/, /\bgrant\b/, /\brevoke\b/, /\bsecurity\b/,
    ]) expect(statements).not.toMatch(forbidden);
  });

  it('is these five statements and nothing else: the two columns, and a note on each', () => {
    expect(statementList()).toEqual([
      'begin',
      ADD_BOTH_COLUMNS,
      `comment on column ${TABLE}.archived_at is ''`,
      `comment on column ${TABLE}.archive_version is ''`,
      'commit',
    ]);
  });

  it('says on the counter, in plain words, that the app did not use it when it was added and what empty means', () => {
    expect(notes).toHaveLength(2);
    const [onTheMark, onTheCounter] = notes;
    expect(onTheMark).toContain('Empty = not archived.');
    expect(onTheCounter).toContain('counter');
    expect(onTheCounter).toContain('later app build');
    expect(onTheCounter).toContain('the app did not use it yet');
    expect(onTheCounter).toContain('Empty = never archived or restored by a build that counts.');
  });
});
