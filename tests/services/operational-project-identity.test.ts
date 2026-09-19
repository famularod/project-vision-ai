import {
  buildOperationalProjectIdentityAuthority,
  resolveOperationalProjectIdentity,
  resolveOperationalReferenceDocumentScope,
} from '../../services/OperationalProjectIdentity';

const PROJECT_2321 = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const PROJECT_2375 = '72e941d8-8114-4082-a976-ae5b2b5daba9';

describe('operational project identity', () => {
  const authority = buildOperationalProjectIdentityAuthority([
    { id: PROJECT_2321, name: '2321 Compliance Project' },
    { id: PROJECT_2375, name: '2375 Compliance Project' },
  ]);

  it('upgrades a legacy name-only record only when the active match is unique', () => {
    expect(resolveOperationalProjectIdentity(
      { projectName: ' 2375 Compliance Project ' },
      authority,
    )).toEqual({
      ok: true,
      identity: { id: PROJECT_2375, name: '2375 Compliance Project' },
    });
  });

  it('accepts an exact id only when its saved name agrees', () => {
    expect(resolveOperationalProjectIdentity(
      { projectId: PROJECT_2321, projectName: '2321 Compliance Project' },
      authority,
    )).toMatchObject({ ok: true });
    expect(resolveOperationalProjectIdentity(
      { projectId: PROJECT_2321, projectName: '2375 Compliance Project' },
      authority,
    )).toMatchObject({ ok: false, code: 'project_identity_mismatch' });
  });

  it('preserves missing, malformed, foreign, and ambiguous records', () => {
    const ambiguousAuthority = buildOperationalProjectIdentityAuthority([
      { id: PROJECT_2321, name: 'Duplicate Project' },
      { id: PROJECT_2375, name: 'Duplicate Project' },
    ]);
    expect(resolveOperationalProjectIdentity({}, authority)).toMatchObject({
      ok: false,
      code: 'project_identity_required',
    });
    expect(resolveOperationalProjectIdentity(
      { projectId: 'not-a-uuid', projectName: '2321 Compliance Project' },
      authority,
    )).toMatchObject({ ok: false, code: 'project_identity_invalid' });
    expect(resolveOperationalProjectIdentity(
      {
        projectId: '11111111-1111-4111-8111-111111111111',
        projectName: '2321 Compliance Project',
      },
      authority,
    )).toMatchObject({ ok: false, code: 'project_identity_invalid' });
    expect(resolveOperationalProjectIdentity(
      { projectName: 'Duplicate Project' },
      ambiguousAuthority,
    )).toMatchObject({ ok: false, code: 'project_identity_ambiguous' });
  });

  it('preserves an exact multi-project document scope without inventing a primary project', () => {
    expect(resolveOperationalReferenceDocumentScope({
      projectId: null,
      projectName: null,
      projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
    }, authority)).toEqual({
      ok: true,
      scope: {
        projectId: null,
        projectName: null,
        projectNames: ['2375 Compliance Project', '2321 Compliance Project'],
      },
    });
  });

  it('fails closed when any shared document project is missing or ambiguous', () => {
    const ambiguousAuthority = buildOperationalProjectIdentityAuthority([
      { id: PROJECT_2321, name: 'Duplicate Project' },
      { id: PROJECT_2375, name: 'Duplicate Project' },
    ]);
    expect(resolveOperationalReferenceDocumentScope({
      projectNames: ['2321 Compliance Project', 'Missing Project'],
    }, authority)).toMatchObject({
      ok: false,
      code: 'project_identity_required',
    });
    expect(resolveOperationalReferenceDocumentScope({
      projectNames: ['Duplicate Project'],
    }, ambiguousAuthority)).toMatchObject({
      ok: false,
      code: 'project_identity_ambiguous',
    });
  });

  it('canonicalizes a one-project document scope to its active cloud identity', () => {
    expect(resolveOperationalReferenceDocumentScope({
      projectNames: [' 2321 Compliance Project '],
    }, authority)).toEqual({
      ok: true,
      scope: {
        projectId: PROJECT_2321,
        projectName: '2321 Compliance Project',
        projectNames: ['2321 Compliance Project'],
      },
    });
  });
});
