/**
 * Owner answer Q44 (6 Oct 2026): the database change behind "archived =
 * hidden on every device, kept in the cloud". The owner pastes it himself, so
 * what it may and may not do is pinned here: it adds one empty column, in one
 * transaction, safe to run twice, and it deletes or rewrites nothing.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

/** The statements themselves: comment lines and the comment text in quotes are not instructions. */
let statements = '';
beforeEach(() => {
  statements = readFileSync(join(__dirname, '../../supabase/migrations/20261006120000_reference_document_archived_mark.sql'), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    .replace(/'[^']*'/g, "''")
    .toLowerCase();
});

describe('the archived-mark database change (owner answer Q44)', () => {
  it('adds the one column, empty, and can be run twice', () => {
    expect(statements).toContain('alter table public.reference_documents\n  add column if not exists archived_at timestamptz;');
    // No default and no "not null": every existing document starts not archived, and no row is rewritten.
    expect(statements).not.toMatch(/archived_at timestamptz\s+(default|not null)/);
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
    // Its only statements: the column, and a note on the column.
    expect(statements.split(';').map(part => part.trim().split(/\s+/).slice(0, 2).join(' ')).filter(Boolean))
      .toEqual(['begin', 'alter table', 'comment on', 'commit']);
  });
});
