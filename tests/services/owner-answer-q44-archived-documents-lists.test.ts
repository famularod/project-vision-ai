/**
 * Owner answer Q44 (6 Oct 2026): the rule behind a project's Documents
 * screen on the phone and the iPad once the cloud keeps the archived mark,
 * and the "Archived (n)" list with Restore.
 */
import {
  buildMobileArchivedDocuments,
  buildMobileDocumentWorkspace,
  mobileArchivedDocumentScopeText,
} from '../../services/MobileDocumentWorkspace';
import type { ReferenceDocument } from '../../types';

const LOT_9 = '11111111-1111-4111-8111-111111111111';
const projects = { projectNames: ['Lot 9'], projectIdentities: [{ id: LOT_9, name: 'Lot 9' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Main St' }] };
const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `${id}.pdf`, category: 'Permit Card', status: 'uploaded', referenceDocumentId: id, isArchived: false, ...extra,
});
const shared = (id: string, extra: Partial<ReferenceDocument> = {}): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', category: 'Permit Card', notes: '', isCurrent: false,
  importedAt: '2026-10-05T15:59:00.000Z', projectId: LOT_9, projectName: 'Lot 9', projectNames: ['Lot 9'], ...extra,
});
const marked = (...ids: string[]) => new Set(ids);

describe('a project\'s Documents list and the archived mark', () => {
  it('a device with no card for it (an iPad, another phone, a reinstall): the archived shared document is not listed', () => {
    const referenceDocuments = [shared('permit'), shared('contract', { category: 'Contract' })];
    expect(buildMobileDocumentWorkspace({ documents: [], referenceDocuments, ...projects }).map(entry => entry.id))
      .toEqual(['reference:permit', 'reference:contract']);
    expect(buildMobileDocumentWorkspace({ documents: [], referenceDocuments, ...projects, archivedSharedDocumentIds: marked('permit') }).map(entry => entry.id))
      .toEqual(['reference:contract']);
  });

  it('a device that still holds its own card for it (a card brought back by a backup): the card is not listed either', () => {
    const documents = [card('permit'), card('other', { referenceDocumentId: 'other-shared' })];
    const referenceDocuments = [shared('permit'), shared('other-shared')];
    expect(buildMobileDocumentWorkspace({ documents, referenceDocuments, ...projects, archivedSharedDocumentIds: marked('permit') }).map(entry => entry.id))
      .toEqual(['attachment:other']);
    // By the shared copy's own id too.
    expect(buildMobileDocumentWorkspace({ documents, referenceDocuments, ...projects, archivedSharedDocumentIds: marked('other-shared') }).map(entry => entry.id))
      .toEqual(['attachment:permit']);
  });

  it('with no mark known (before the database change) the list is exactly what it was', () => {
    const documents = [card('permit', { isArchived: true }), card('other')];
    const referenceDocuments = [shared('permit'), shared('third')];
    const before = buildMobileDocumentWorkspace({ documents, referenceDocuments, ...projects });
    expect(buildMobileDocumentWorkspace({ documents, referenceDocuments, ...projects, archivedSharedDocumentIds: new Set() })).toEqual(before);
    expect(before.map(entry => entry.id)).toEqual(['attachment:other', 'reference:third']);
  });
});

describe('"Archived (n)" under a project\'s Documents', () => {
  it('lists this device\'s archived cards and the shared documents the cloud marks archived, each once, for this project only', () => {
    const documents = [card('permit', { isArchived: true }), card('active')];
    const referenceDocuments = [shared('permit'), shared('contract', { category: 'Contract' }), shared('elsewhere', { projectId: '22222222-2222-4222-8222-222222222222', projectName: 'Main St', projectNames: ['Main St'] }), shared('listed')];
    expect(buildMobileArchivedDocuments({
      documents, referenceDocuments, ...projects,
      archive: { installed: true, archivedIds: marked('permit', 'contract', 'elsewhere'), waitingIds: new Set() },
    })).toEqual([
      { key: 'attachment:permit', name: 'permit.pdf', category: 'Permit Card', cardId: 'permit', sharedDocumentId: 'permit', scope: 'everywhere' },
      { key: 'reference:contract', name: 'contract', category: 'Contract', cardId: null, sharedDocumentId: 'contract', scope: 'everywhere' },
    ]);
  });

  it('says where each one is hidden: every device, this device until it reaches the cloud, or this device', () => {
    const documents = [card('sent', { isArchived: true }), card('waiting', { isArchived: true }), card('old', { isArchived: true }), card('local', { isArchived: true, referenceDocumentId: null })];
    const referenceDocuments = [shared('sent'), shared('waiting'), shared('old')];
    const scopes = (installed: boolean | null) => buildMobileArchivedDocuments({
      documents, referenceDocuments, ...projects,
      archive: { installed, archivedIds: marked('sent', 'waiting'), waitingIds: marked('waiting') },
    }).map(entry => `${entry.cardId}:${entry.scope}`);
    // 'old' was archived on this phone before the mark existed: its shared copy carries none.
    expect(scopes(true)).toEqual(['sent:everywhere', 'waiting:waiting', 'old:this_device', 'local:this_device']);
    // Before the database change nothing waits on signal: it is hidden here, and that is all that is said.
    expect(scopes(false)).toEqual(['sent:everywhere', 'waiting:this_device', 'old:this_device', 'local:this_device']);
    // A device that has never had an answer says the same (review of D1, L9).
    expect(scopes(null)).toEqual(['sent:everywhere', 'waiting:this_device', 'old:this_device', 'local:this_device']);
    expect(mobileArchivedDocumentScopeText('everywhere')).toBe('Hidden on all your devices. Kept in the cloud.');
    expect(mobileArchivedDocumentScopeText('waiting')).toBe('Hidden on this device. Your other devices follow as soon as this one reaches the cloud.');
    expect(mobileArchivedDocumentScopeText('this_device')).toBe('Hidden on this device.');
  });

  it('a project with nothing archived has no such list', () => {
    expect(buildMobileArchivedDocuments({
      documents: [card('active')], referenceDocuments: [shared('active'), shared('listed')], ...projects,
      archive: { installed: true, archivedIds: new Set(), waitingIds: new Set() },
    })).toEqual([]);
  });
});
