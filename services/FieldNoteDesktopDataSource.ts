import { daveWebSupabaseGateway } from './DAVEWebSupabaseClient';
import type { FieldNoteWorkspaceDataSource } from './FieldNoteMobileSync';

export const desktopFieldNoteDataSource: FieldNoteWorkspaceDataSource = Object.freeze({
  list: () => daveWebSupabaseGateway.fieldNotes.list(),
  save: (_ownerKey, note) => daveWebSupabaseGateway.fieldNotes.create(note),
  update: (_ownerKey, note) =>
    daveWebSupabaseGateway.fieldNotes.update(note, note.revision),
  subscribe: (_ownerKey, onChange, onStatus) =>
    daveWebSupabaseGateway.fieldNotes.subscribe(
      async note => {
        const notes = await daveWebSupabaseGateway.fieldNotes.list();
        onChange(notes.some(item => item.id === note.id) ? notes : [note, ...notes]);
      },
      onStatus,
    ),
});
