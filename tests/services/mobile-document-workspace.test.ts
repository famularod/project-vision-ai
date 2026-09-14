import { buildMobileDocumentWorkspace } from '../../services/MobileDocumentWorkspace';
import { filterDAVEDocumentWorkspace } from '../../services/DAVEDocumentWorkspace';
import type { ReferenceDocument } from '../../types';

const projects = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'North' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'South' },
];
const ref = (id: string, extra: Partial<ReferenceDocument> = {}): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', category: 'Drawing', notes: '',
  isCurrent: false, importedAt: '2026-09-14', projectId: projects[0].id, projectName: 'North', ...extra,
});
type LocalDocument = { id: string; name: string; category: string; status: string; referenceDocumentId?: string; isArchived?: boolean };
const build = (referenceDocuments: ReferenceDocument[], documents: LocalDocument[] = [], projectNames = ['North'], projectIdentities = projects) =>
  buildMobileDocumentWorkspace({ documents, referenceDocuments, projectNames, projectIdentities });

describe('mobile shared document inventory', () => {
  it('shows cloud-only documents with no device attachments and preserves exact source identity', () => {
    const document = ref('B');
    const rows = build([document]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'reference:B', kind: 'reference', status: 'shared reference' });
    expect(rows[0].kind === 'reference' && rows[0].reference).toBe(document);
    expect(rows[0]).not.toHaveProperty('attachment');
  });
  it('includes explicitly shared schedules in each project and maps the category filter', () => {
    const schedule = ref('schedule', { projectId: null, projectName: null, projectNames: ['North', 'South'], category: 'Schedules' });
    expect(filterDAVEDocumentWorkspace({ documents: build([schedule]), category: 'Schedule' })).toHaveLength(1);
    expect(build([schedule], [], ['South'])).toHaveLength(1);
    expect(build([ref('plan', { category: 'Plans' })])[0].category).toBe('Drawing');
    expect(build([ref('unknown', { category: 'New type' })])[0].category).toBe('Other');
  });
  it('blocks other projects, unscoped records, mismatched identities and ambiguous names', () => {
    const other = ref('other', { projectId: projects[1].id, projectName: 'South' });
    const unscoped = ref('missing', { projectId: null, projectName: null });
    const mismatch = ref('bad', { projectId: projects[1].id });
    expect(build([other, unscoped, mismatch])).toEqual([]);
    expect(build([ref('ambiguous', { projectId: null })], [], ['North'], [...projects, { id: '33333333-3333-4333-8333-333333333333', name: 'North' }])).toEqual([]);
    expect(build([ref('A')], [], ['South'])).toEqual([]);
  });
  it('deduplicates only exact bridges and never resurrects an archived attachment', () => {
    const local = { id: 'local-A', referenceDocumentId: 'A', name: 'same.pdf', category: 'Drawing', status: 'uploaded' };
    expect(build([ref('A'), ref('B', { name: 'same.pdf' })], [local])).toHaveLength(2);
    expect(build([ref('A')], [{ ...local, isArchived: true }])).toEqual([]);
    expect(build([ref('A'), ref('A')])).toHaveLength(1);
    expect(build([ref('local-A')], [local])).toHaveLength(1);
  });
  it('does not mutate source records or confuse prefixed identity collisions', () => {
    const document = Object.freeze(ref('A'));
    const local = Object.freeze({ id: 'reference:A', name: 'local', category: 'Other', status: 'local' });
    const rows = build([document], [local]);
    expect(rows.map(row => row.id)).toEqual(['attachment:reference:A', 'reference:A']);
    expect(rows[0].kind === 'attachment' && rows[0].attachment).toBe(local);
  });
});
