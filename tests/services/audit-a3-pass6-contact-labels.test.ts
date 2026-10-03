const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
const types = fs.readFileSync(path.resolve(__dirname, '../../types/index.ts'), 'utf8');

// Whole-app audit A3 pass 6 L1 (30 Sep 2026): the picker said the chosen
// email and phone were "kept with the update", but an update keeps only the
// contact's id. The chip changes the contact itself, for every update with
// that contact, and picking the contact again from the phone resets it.
describe('a contact\'s email and phone chips say they are saved on the contact (L1)', () => {
  it('an update keeps contact ids only, and the chip changes the shared contact', () => {
    const start = types.indexOf('export type RecipientSelection = {');
    expect(types.slice(start, types.indexOf('};', start))).toMatch(/= \{\s*contactIds: string\[\];\s*$/);
    const choice = app.indexOf('\n  function updateContactDeliveryChoice(');
    const body = app.slice(choice, app.indexOf('\n  }\n', choice));
    expect(body).toContain('setContactBook(');
    expect(body).not.toContain('setDraft(');
  });

  it('labels the chips as saved on this contact', () => {
    expect(app).toContain('<Text style={styles.label}>Email saved on this contact</Text>');
    expect(app).toContain('<Text style={styles.label}>Phone saved on this contact</Text>');
    expect(app).not.toContain('Email kept with the update');
    expect(app).not.toContain('Phone kept with the update');
    // Forbidden since pass 4: the app does not send to contacts.
    expect(app).not.toContain('Email to use');
    expect(app).not.toContain('Phone to use for text');
  });
});
