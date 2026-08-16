import {
  projectTombstoneMatchesRecord,
  projectTombstoneUsesExactId,
  resolveProjectTombstoneAuthority,
} from '../../services/ProjectTombstoneAuthority';

const PROJECT_A_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_B_ID = '22222222-2222-4222-8222-222222222222';

describe('project tombstone authority', () => {
  it('recognizes an exact id only through the supplied project authority', () => {
    const projects = [
      { id: PROJECT_A_ID, name: 'Project A' },
      { id: PROJECT_B_ID, name: 'Project B' },
    ];
    expect(resolveProjectTombstoneAuthority(PROJECT_A_ID, projects)).toBe('exact_id');
    expect(projectTombstoneUsesExactId(PROJECT_A_ID, projects)).toBe(true);
    expect(projectTombstoneMatchesRecord(PROJECT_A_ID, projects[0], projects)).toBe(true);
    expect(projectTombstoneMatchesRecord(PROJECT_A_ID, projects[1], projects)).toBe(false);
  });

  it('does not infer exact authority from UUID syntax when it is a legacy name', () => {
    const projects = [{ id: PROJECT_A_ID, name: PROJECT_B_ID }];
    expect(resolveProjectTombstoneAuthority(PROJECT_B_ID, projects)).toBe('legacy_name');
    expect(projectTombstoneUsesExactId(PROJECT_B_ID, projects)).toBe(false);
    expect(projectTombstoneMatchesRecord(PROJECT_B_ID, projects[0], projects)).toBe(true);
  });

  it('fails closed when one legacy name collides with another project id', () => {
    const projects = [
      { id: PROJECT_A_ID, name: PROJECT_B_ID },
      { id: PROJECT_B_ID, name: 'Project B' },
    ];
    expect(resolveProjectTombstoneAuthority(PROJECT_B_ID, projects)).toBe('ambiguous');
    expect(projectTombstoneMatchesRecord(PROJECT_B_ID, projects[0], projects)).toBe(false);
    expect(projectTombstoneMatchesRecord(PROJECT_B_ID, projects[1], projects)).toBe(false);
  });
});
