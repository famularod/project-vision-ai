import { reconcileDAVEOperationalProjects } from '../../services/DAVEOperationalProjectRecovery';
import { projectNameAvailability } from '../../services/ProjectNameRules';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit A3 pass 5 (30 Sep 2026).
describe('a name that looks like a closed project\'s is offered for reopening (L1)', () => {
  // The refresh keeps a closed project in the project list as well as the
  // archived list, and closing one on this phone only adds it to the archived
  // list, so the closed name is on both lists when a new project is added.
  const reconciled = reconcileDAVEOperationalProjects({
    localRecords: [{ id: 'project-1', name: 'Lot 5' }, { id: 'project-2', name: '2375 Main St' }],
    localArchivedProjectNames: ['2375 Main St'],
    cloudActiveRecords: [{ id: 'project-1', name: 'Lot 5' }],
    cloudArchivedRecords: [{ id: 'project-2', name: '2375 Main St' }],
  });
  const availability = (projectName: string) => projectNameAvailability({
    projectName,
    projects: reconciled.projectNames,
    archivedProjects: reconciled.archivedProjectNames,
    deletedProjectNames: [],
    tombstones: [],
  });

  it('starts from a closed name that is on both lists', () => {
    expect(reconciled.projectNames).toEqual(['Lot 5', '2375 Main St']);
    expect(reconciled.archivedProjectNames).toEqual(['2375 Main St']);
  });

  it('answers a look-alike of the closed project with the archived list, so Reopen is offered', () => {
    expect(availability('2375 Main St.')).toEqual({ kind: 'similar', projectName: '2375 Main St', source: 'archived' });
    expect(availability('2375 main st')).toEqual({ kind: 'archived', projectName: '2375 Main St' });
  });

  it('still refuses a look-alike of an open project as sharing its documents', () => {
    expect(availability('Lot-5')).toEqual({ kind: 'similar', projectName: 'Lot 5', source: 'active' });
    expect(availability('lot 5')).toEqual({ kind: 'exists' });
  });

  it('addProject passes the whole project list, closed projects included', () => {
    const start = app.indexOf('\nfunction addProject(projectName: string) {');
    const body = app.slice(start, app.indexOf('\n  function addAndChangeDraftProject(', start));
    expect(body).toContain('projectName: trimmed, projects, archivedProjects,');
  });
});

describe('the delete wording says the name is retired (L2)', () => {
  it('says what is removed and that the name cannot be used again', () => {
    expect(app).toContain('label="Hold to Delete Project"');
    expect(app).toContain(
      'Hold for 3 seconds to delete {projectName}. Its updates, tasks, areas and documents are removed on every device. ' +
      'The name {projectName} can\'t be used for a new project afterwards.',
    );
    expect(app).not.toContain('Hold for 3 seconds to remove {projectName}.');
  });
});

describe('a contact\'s email and phone say what the picker keeps (L3, owner answer Q18)', () => {
  // Pin updated in audit A3 pass 6 (L1): "kept with the update" was not true,
  // an update keeps only the contact's id; the chip changes the contact.
  it('labels the always-selected chip as saved on the contact, not optional', () => {
    expect(app).toContain('<Text style={styles.label}>Email saved on this contact</Text>');
    expect(app).toContain('<Text style={styles.label}>Phone saved on this contact</Text>');
    expect(app).not.toContain('Email (optional)');
    expect(app).not.toContain('Phone (optional)');
  });
});
