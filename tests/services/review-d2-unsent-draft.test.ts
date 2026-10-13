/**
 * Second review of the archive change, P2-L5 (the coordinator's decision):
 * an update that is still being written. Nothing is taken off any record
 * because of an archive, and a SENT update keeps showing a document it was
 * sent with. But an unsent update has not been sent: while a document on it
 * is archived it is not shown on that update and does not go out with it;
 * restored before sending, it is on the update again and is sent.
 *
 * The rule itself, in the view service the last batch added. The real
 * screens and the real Save are in
 * tests/app-archived-document-hidden-everywhere.test.tsx.
 */
import { unsentUpdateWithoutArchivedDocuments } from '../../services/SharedDocumentArchiveView';

const permit = { id: 'card-permit', referenceDocumentId: 'doc-permit', name: 'Grading permit.pdf' };
const plan = { id: 'card-plan', referenceDocumentId: 'doc-plan', name: 'Site plan.pdf' };
const photoOnly: { id: string; notes: string; photos: string[]; documents?: Array<{ id: string }> } = { id: 'draft-2', notes: 'Footings poured', photos: ['photo-1'] };
const draft = { id: 'draft-1', notes: 'Inspector asked to see the permit', photos: [] as string[], documents: [permit, plan] };
const cards = [{ id: 'card-permit', referenceDocumentId: 'doc-permit', isArchived: false }, { id: 'card-plan', referenceDocumentId: 'doc-plan', isArchived: false }];
const NOTHING = new Set<string>();

describe('P2-L5: an update he is still writing, and a document on it that is archived', () => {
  it('with nothing archived the very same update comes back: nothing about it is worked out again', () => {
    expect(unsentUpdateWithoutArchivedDocuments(draft, cards, NOTHING)).toBe(draft);
    expect(unsentUpdateWithoutArchivedDocuments(draft, cards, new Set(['doc-other']))).toBe(draft);
    expect(unsentUpdateWithoutArchivedDocuments(photoOnly, cards, new Set(['doc-permit']))).toBe(photoOnly);
    expect(unsentUpdateWithoutArchivedDocuments({ ...draft, documents: [] }, cards, new Set(['doc-permit'])).documents).toEqual([]);
  });

  it('archived on this phone before the database change is installed (the card is put away; the device knows no mark): it leaves the update', () => {
    const archivedHere = [{ ...cards[0], isArchived: true }, cards[1]];
    const shown = unsentUpdateWithoutArchivedDocuments(draft, archivedHere, NOTHING);
    expect(shown.documents).toEqual([plan]);
    expect(shown).toEqual({ ...draft, documents: [plan] }); // everything else of the update is as it was
    expect(draft.documents).toEqual([permit, plan]); // and the update's own record is not touched
  });

  it('archived in the cloud (on this device or another): it leaves the update, whether the device knows the shared copy by the card\'s link, the draft\'s own link, or the card\'s id', () => {
    expect(unsentUpdateWithoutArchivedDocuments(draft, cards, new Set(['doc-permit'])).documents).toEqual([plan]);
    // The draft's copy of the card was made before the card was linked to its shared copy: the card's own link is used.
    const unlinkedOnTheDraft = { ...draft, documents: [{ id: 'card-permit', name: 'Grading permit.pdf' }, plan] };
    expect(unsentUpdateWithoutArchivedDocuments(unlinkedOnTheDraft, cards, new Set(['doc-permit'])).documents).toEqual([plan]);
    // No card on this phone for it (the list of cards has not loaded): the draft's own link is enough.
    expect(unsentUpdateWithoutArchivedDocuments(draft, [], new Set(['doc-permit'])).documents).toEqual([plan]);
    // A shared copy that carries the card's own id.
    const sameId = { ...draft, documents: [{ id: 'doc-permit', name: 'Grading permit.pdf' }] };
    expect(unsentUpdateWithoutArchivedDocuments(sameId, [], new Set(['doc-permit'])).documents).toEqual([]);
  });

  it('restored before he sends: it is on the update again, as it was', () => {
    const whileArchived = unsentUpdateWithoutArchivedDocuments(draft, [{ ...cards[0], isArchived: true }, cards[1]], new Set(['doc-permit']));
    expect(whileArchived.documents).toEqual([plan]);
    expect(unsentUpdateWithoutArchivedDocuments(draft, cards, NOTHING)).toBe(draft);
    expect(unsentUpdateWithoutArchivedDocuments(draft, cards, NOTHING).documents).toEqual([permit, plan]);
  });

  it('every document on it archived: the update is shown and sent with none', () => {
    expect(unsentUpdateWithoutArchivedDocuments(draft, cards, new Set(['doc-permit', 'doc-plan'])).documents).toEqual([]);
  });
});
