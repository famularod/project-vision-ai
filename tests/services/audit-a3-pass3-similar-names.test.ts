import { projectNameAvailability, similarProjectNameMessage } from '../../services/ProjectNameRules';
import { isReservedLegacyProjectName } from '../../services/ReservedProjectNames';
import { legacyProjectNameKey } from '../../services/OperationalProjectIdentity';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit A3 pass 3 (30 Sep 2026): phone documents, cover photos and
// the delete cascade are keyed by legacyProjectNameKey, which ignores
// punctuation and spacing, so "Lot 5" and "Lot-5" shared documents and
// deleting one removed the other's.
describe('a name that would share another project\'s document key is refused', () => {
  const availability = (projectName: string, extra: Partial<Parameters<typeof projectNameAvailability>[0]> = {}) =>
    projectNameAvailability({
      projectName,
      projects: ['Lot 5'],
      archivedProjects: ['2375 Main St'],
      deletedProjectNames: ['Tower B'],
      tombstones: [
        { entityType: 'project', recordId: 'Old Yard', deletedAt: '2026-09-01T12:00:00.000Z' },
        { entityType: 'project_area', recordId: 'Gate-3', deletedAt: '2026-09-01T12:00:00.000Z' },
      ],
      ...extra,
    });

  it('names the listed, archived or deleted project it collides with', () => {
    expect(legacyProjectNameKey('Lot-5')).toBe(legacyProjectNameKey('Lot 5'));
    expect(availability('Lot-5')).toEqual({ kind: 'similar', projectName: 'Lot 5' });
    expect(availability('lot   5')).toEqual({ kind: 'similar', projectName: 'Lot 5' });
    expect(availability('2375 Main St.')).toEqual({ kind: 'similar', projectName: '2375 Main St' });
    expect(availability('Tower-B')).toEqual({ kind: 'similar', projectName: 'Tower B' });
    expect(availability('Old-Yard')).toEqual({ kind: 'similar', projectName: 'Old Yard' });
    // Only project deletion records count.
    expect(availability('Gate 3')).toEqual({ kind: 'available' });
  });

  it('keeps the exact-name answers and allows genuinely different names', () => {
    expect(availability(' lot 5 ')).toEqual({ kind: 'exists' });
    expect(availability('2375 MAIN ST')).toEqual({ kind: 'archived', projectName: '2375 Main St' });
    expect(availability('Lot 50')).toEqual({ kind: 'available' });
    expect(availability('Lot 5 East')).toEqual({ kind: 'available' });
    expect(availability('Lot 6')).toEqual({ kind: 'available' });
  });

  it('says which project it is too close to and why', () => {
    expect(similarProjectNameMessage('Lot-5', 'Lot 5')).toBe(
      'Lot-5 is too close to Lot 5. The app files documents by project name with punctuation and spacing ignored, ' +
      'so the two projects would share documents. Please choose a different name.',
    );
  });

  it('is wired in addProject after the exact-name checks', () => {
    const start = app.indexOf('\nfunction addProject(projectName: string) {');
    const body = app.slice(start, app.indexOf('\n  function addAndChangeDraftProject(', start));
    expect(body).toContain("Alert.alert('Name not available', similarProjectNameMessage(trimmed, availability.projectName));");
    expect(body.indexOf("availability.kind === 'similar'")).toBeGreaterThan(body.indexOf("'Already added'"));
    expect(body.indexOf("availability.kind === 'similar'")).toBeLessThan(body.indexOf('setProjects(prev => [trimmed, ...prev]);'));
  });
});

describe('legacy names are reserved by document key too', () => {
  it('reserves spellings the launch-time document migration would claim', () => {
    expect(isReservedLegacyProjectName('Building 2321 East Driveway')).toBe(true);
    expect(isReservedLegacyProjectName('3-Hour Fire Wall')).toBe(true);
    expect(isReservedLegacyProjectName('Canopy-A')).toBe(true);
    expect(isReservedLegacyProjectName('H 2 Room')).toBe(true);
    expect(isReservedLegacyProjectName('tank-farm')).toBe(true);
  });

  it('still allows ordinary and parent project names', () => {
    expect(isReservedLegacyProjectName('Canopy D')).toBe(false);
    expect(isReservedLegacyProjectName('Tank Farm Phase 2')).toBe(false);
    expect(isReservedLegacyProjectName('2375 Compliance Project')).toBe(false);
    expect(isReservedLegacyProjectName('!!!')).toBe(false);
  });
});
