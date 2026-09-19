import {
  evaluateVitruviusBetaAuthorization,
  outsidePilotAskEcosIsAccepted,
  vitruviusAudienceCanAccessAskEcos,
  vitruviusProjectRoleHasPermission,
  type VitruviusOrganizationMembership,
  type VitruviusProjectMembership,
} from '../../services/VitruviusBetaAuthorization';

const releaseCandidate = {
  version: '1.0.160',
  build: '160',
  sourceRevision: 'abcdef1234567890',
} as const;

const acceptedAskEcosControl = {
  mode: 'accepted_for_pilot',
  currentCandidate: releaseCandidate,
  acceptanceStatus: 'pass',
  acceptedCandidate: releaseCandidate,
  multiProjectLiveAcceptanceStatus: 'pass',
  exactProofStatus: 'pass',
  negativeControlStatus: 'pass',
  evidenceRefs: ['validation/ecos/live-acceptance.json'],
} as const;

const organizationMembership: VitruviusOrganizationMembership = {
  userId: 'user-1',
  organizationId: 'org-1',
  status: 'active',
  role: 'member',
};

const projectMembership: VitruviusProjectMembership = {
  userId: 'user-1',
  organizationId: 'org-1',
  projectId: 'project-1',
  status: 'active',
  role: 'contributor',
};

function decide(overrides: Partial<Parameters<typeof evaluateVitruviusBetaAuthorization>[0]> = {}) {
  return evaluateVitruviusBetaAuthorization({
    userId: 'user-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    permission: 'view_project',
    organizationMembership,
    projectMembership,
    ...overrides,
  });
}

describe('Vitruvius beta project authorization', () => {
  it('uses a least-privilege project role matrix', () => {
    expect(vitruviusProjectRoleHasPermission('viewer', 'ask_ecos')).toBe(true);
    expect(vitruviusProjectRoleHasPermission('viewer', 'update_tasks')).toBe(false);
    expect(vitruviusProjectRoleHasPermission('contributor', 'update_tasks')).toBe(true);
    expect(vitruviusProjectRoleHasPermission('contributor', 'manage_documents')).toBe(false);
    expect(vitruviusProjectRoleHasPermission('project_manager', 'export_project')).toBe(true);
    expect(vitruviusProjectRoleHasPermission('project_manager', 'delete_project')).toBe(false);
    expect(vitruviusProjectRoleHasPermission('project_admin', 'delete_project')).toBe(true);
    expect(vitruviusProjectRoleHasPermission('unknown', 'view_project')).toBe(false);
  });

  it('retains the current owner-supported beta path for an active organization administrator', () => {
    expect(decide({
      permission: 'delete_project',
      organizationMembership: { ...organizationMembership, role: 'organization_admin' },
      projectMembership: null,
    })).toEqual({ allowed: true, reason: 'active_organization_admin' });
  });

  it('requires exact organization and project boundaries for a team member', () => {
    expect(decide({
      projectMembership: { ...projectMembership, projectId: 'another-project' },
    })).toEqual({ allowed: false, reason: 'project_scope_mismatch' });
    expect(decide({
      organizationMembership: { ...organizationMembership, organizationId: 'another-org' },
    })).toEqual({ allowed: false, reason: 'organization_scope_mismatch' });
  });

  it('denies invited, suspended, removed, missing, and underprivileged memberships', () => {
    expect(decide({
      organizationMembership: { ...organizationMembership, status: 'suspended' },
    }).allowed).toBe(false);
    expect(decide({
      projectMembership: { ...projectMembership, status: 'invited' },
    })).toEqual({ allowed: false, reason: 'project_membership_inactive' });
    expect(decide({ projectMembership: null })).toEqual({
      allowed: false,
      reason: 'project_membership_missing',
    });
    expect(decide({
      permission: 'manage_documents',
    })).toEqual({ allowed: false, reason: 'insufficient_project_role' });
  });

  it('allows only capabilities granted to the active project role', () => {
    expect(decide({ permission: 'update_tasks' })).toEqual({
      allowed: true,
      reason: 'active_project_membership',
    });
    expect(decide({
      permission: 'manage_documents',
      projectMembership: { ...projectMembership, role: 'project_manager' },
    }).allowed).toBe(true);
  });

  it('denies Ask ECOS to an outside beta member by default', () => {
    expect(decide({ permission: 'ask_ecos' })).toEqual({
      allowed: false,
      reason: 'ask_ecos_disabled_for_pilot',
    });
    expect(vitruviusAudienceCanAccessAskEcos('outside_pilot')).toBe(false);
  });

  it('preserves owner/admin internal Ask ECOS acceptance access', () => {
    expect(decide({
      permission: 'ask_ecos',
      organizationMembership: { ...organizationMembership, role: 'organization_admin' },
      projectMembership: null,
    })).toEqual({ allowed: true, reason: 'active_organization_admin' });
    expect(vitruviusAudienceCanAccessAskEcos('owner_internal')).toBe(true);
  });

  it('requires same-candidate multi-project, proof, and negative-control acceptance', () => {
    expect(outsidePilotAskEcosIsAccepted(acceptedAskEcosControl)).toBe(true);
    expect(decide({
      permission: 'ask_ecos',
      askEcosPilotControl: acceptedAskEcosControl,
    })).toEqual({ allowed: true, reason: 'active_project_membership' });

    const stale = {
      ...acceptedAskEcosControl,
      acceptedCandidate: { ...releaseCandidate, build: '159' },
    } as const;
    expect(outsidePilotAskEcosIsAccepted(stale)).toBe(false);
    expect(decide({ permission: 'ask_ecos', askEcosPilotControl: stale })).toEqual({
      allowed: false,
      reason: 'ask_ecos_acceptance_missing_or_stale',
    });
  });
});
