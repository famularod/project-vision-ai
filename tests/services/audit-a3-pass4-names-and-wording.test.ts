import {
  archivedProjectNameMessage,
  projectNameAvailability,
  similarProjectNameMessage,
} from '../../services/ProjectNameRules';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit A3 pass 4 (30 Sep 2026), finding 3: wording leftovers.
describe('a look-alike name is answered by the list it is on', () => {
  const availability = (projectName: string, extra: Partial<Parameters<typeof projectNameAvailability>[0]> = {}) =>
    projectNameAvailability({
      projectName,
      projects: ['Lot 5'],
      archivedProjects: ['2375 Main St'],
      deletedProjectNames: [],
      tombstones: [],
      ...extra,
    });

  it('offers to reopen an archived look-alike', () => {
    expect(availability('2375 Main St.')).toEqual({ kind: 'similar', projectName: '2375 Main St', source: 'archived' });
    expect(archivedProjectNameMessage('2375 Main St.', '2375 Main St')).toBe(
      '2375 Main St. is too close to 2375 Main St, which is in your archived projects. ' +
      'Reopen 2375 Main St to record updates against it again, or choose a different name.',
    );
    expect(archivedProjectNameMessage('2375 main st', '2375 Main St')).toBe(
      '2375 main st is in your archived projects. Reopen it to record updates against it again.',
    );
    const start = app.indexOf('\nfunction addProject(projectName: string) {');
    const body = app.slice(start, app.indexOf('\n  function addAndChangeDraftProject(', start));
    expect(body).toContain("if (availability.kind === 'archived' || (availability.kind === 'similar' && availability.source === 'archived')) {");
    expect(body).toContain("Alert.alert('Project is archived', archivedProjectNameMessage(trimmed, availability.projectName), [");
    expect(body).toContain("{ text: 'Reopen', onPress: () => reopenProject(availability.projectName) },");
  });

  it('does not say a deleted look-alike would share documents', () => {
    const message = similarProjectNameMessage('Lot-5 Eats', 'Lot 5 Eats', 'deleted');
    expect(message).toBe(
      'Lot-5 Eats is too close to Lot 5 Eats, a deleted project. The app compares project names with ' +
      'punctuation and spacing ignored, and a deleted project\'s name cannot be used again yet. Please choose a different name.',
    );
    expect(message).not.toContain('share documents');
    expect(similarProjectNameMessage('Lot-5', 'Lot 5', 'active')).toContain('so the two projects would share documents');
  });

  it('shows a deleted project\'s name as the owner typed it, not the cloud\'s lower-case record', () => {
    // The cloud's copy of the deletion record reached the deleted list first.
    expect(availability('Lot-5 Eats', {
      deletedProjectNames: ['lot 5 eats'],
      tombstones: [{ entityType: 'project', recordId: 'Lot 5 Eats', deletedAt: '2026-09-30T12:00:00.000Z' }],
    })).toEqual({ kind: 'similar', projectName: 'Lot 5 Eats', source: 'deleted' });
    expect(availability('Lot-5 Eats', {
      tombstones: [{ entityType: 'project', recordId: 'lot 5 eats', deletedAt: '2026-09-30T12:00:00.000Z' }],
    })).toEqual({ kind: 'similar', projectName: 'lot 5 eats', source: 'deleted' });
  });
});

describe('wording says what the app does (audit A3 pass 4, 3)', () => {
  it('uses "Close Project" for the Workspace button and its dialog', () => {
    expect(app).toContain('label="Close Project"');
    expect(app).not.toContain('label="Archive Project"');
    expect(app).toContain("'Close Project?',");
    expect(app).not.toContain("'Close project?'");
  });

  // Pin updated in audit A3 pass 5 (L3): the picker always has one address
  // selected and has no "none" choice, so "(optional)" became "kept with the
  // update" (owner answer Q18: the app never sends to contacts).
  it('labels a contact\'s email and phone as kept with the update: the app never sends to contacts (owner answer Q18)', () => {
    expect(app).toContain('<Text style={styles.label}>Email kept with the update</Text>');
    expect(app).toContain('<Text style={styles.label}>Phone kept with the update</Text>');
    expect(app).not.toContain('Email to use');
    expect(app).not.toContain('Phone to use for text');
  });
});
