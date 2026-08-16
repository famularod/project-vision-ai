export type VitruviusOrganizationRole =
  | 'member'
  | 'project_manager'
  | 'decision_owner'
  | 'validation_authority'
  | 'organization_admin';

export type VitruviusProjectRole =
  | 'viewer'
  | 'contributor'
  | 'project_manager'
  | 'project_admin';

export type VitruviusMembershipStatus =
  | 'active'
  | 'invited'
  | 'suspended'
  | 'removed';

export type VitruviusProjectPermission =
  | 'view_project'
  | 'ask_ecos'
  | 'create_field_note'
  | 'upload_photos'
  | 'update_tasks'
  | 'manage_documents'
  | 'approve_ecos_proposals'
  | 'export_project'
  | 'manage_project_members'
  | 'archive_project'
  | 'delete_project';

export type VitruviusBetaAudience = 'owner_internal' | 'outside_pilot';

export type VitruviusAskEcosPilotMode =
  | 'disabled_for_pilot'
  | 'accepted_for_pilot';

export type VitruviusReleaseCandidateIdentity = Readonly<{
  version: string;
  build: string;
  sourceRevision: string;
}>;

export type VitruviusAskEcosPilotControl = Readonly<{
  mode: VitruviusAskEcosPilotMode;
  currentCandidate: VitruviusReleaseCandidateIdentity;
  acceptanceStatus: 'pending' | 'pass' | 'fail';
  acceptedCandidate: VitruviusReleaseCandidateIdentity | null;
  multiProjectLiveAcceptanceStatus: 'pending' | 'pass' | 'fail';
  exactProofStatus: 'pending' | 'pass' | 'fail';
  negativeControlStatus: 'pending' | 'pass' | 'fail';
  evidenceRefs: readonly string[];
}>;

export const FIRST_OUTSIDE_PILOT_ASK_ECOS_MODE: VitruviusAskEcosPilotMode =
  'disabled_for_pilot';

export type VitruviusOrganizationMembership = Readonly<{
  userId: string;
  organizationId: string;
  status: VitruviusMembershipStatus;
  role: VitruviusOrganizationRole;
}>;

export type VitruviusProjectMembership = Readonly<{
  userId: string;
  organizationId: string;
  projectId: string;
  status: VitruviusMembershipStatus;
  role: VitruviusProjectRole;
}>;

export type VitruviusBetaAuthorizationReason =
  | 'active_organization_admin'
  | 'active_project_membership'
  | 'invalid_scope'
  | 'organization_scope_mismatch'
  | 'organization_membership_inactive'
  | 'project_scope_mismatch'
  | 'project_membership_inactive'
  | 'project_membership_missing'
  | 'insufficient_project_role'
  | 'ask_ecos_disabled_for_pilot'
  | 'ask_ecos_acceptance_missing_or_stale';

export type VitruviusBetaAuthorizationDecision = Readonly<{
  allowed: boolean;
  reason: VitruviusBetaAuthorizationReason;
}>;

const VIEWER_PERMISSIONS: readonly VitruviusProjectPermission[] = Object.freeze([
  'view_project',
  'ask_ecos',
]);

const CONTRIBUTOR_PERMISSIONS: readonly VitruviusProjectPermission[] = Object.freeze([
  ...VIEWER_PERMISSIONS,
  'create_field_note',
  'upload_photos',
  'update_tasks',
]);

const PROJECT_MANAGER_PERMISSIONS: readonly VitruviusProjectPermission[] = Object.freeze([
  ...CONTRIBUTOR_PERMISSIONS,
  'manage_documents',
  'approve_ecos_proposals',
  'export_project',
]);

const PROJECT_ADMIN_PERMISSIONS: readonly VitruviusProjectPermission[] = Object.freeze([
  ...PROJECT_MANAGER_PERMISSIONS,
  'manage_project_members',
  'archive_project',
  'delete_project',
]);

const ROLE_PERMISSIONS: Readonly<Record<VitruviusProjectRole, readonly VitruviusProjectPermission[]>> =
  Object.freeze({
    viewer: VIEWER_PERMISSIONS,
    contributor: CONTRIBUTOR_PERMISSIONS,
    project_manager: PROJECT_MANAGER_PERMISSIONS,
    project_admin: PROJECT_ADMIN_PERMISSIONS,
  });

export function vitruviusProjectRoleHasPermission(
  role: string,
  permission: string,
): boolean {
  const permissions = ROLE_PERMISSIONS[role as VitruviusProjectRole];
  return Boolean(permissions?.includes(permission as VitruviusProjectPermission));
}

export function outsidePilotAskEcosIsAccepted(
  control: VitruviusAskEcosPilotControl | null | undefined,
): boolean {
  if (!control || control.mode !== 'accepted_for_pilot') return false;
  if (
    control.acceptanceStatus !== 'pass' ||
    control.multiProjectLiveAcceptanceStatus !== 'pass' ||
    control.exactProofStatus !== 'pass' ||
    control.negativeControlStatus !== 'pass' ||
    control.evidenceRefs.filter(nonEmpty).length === 0 ||
    !releaseCandidateIsComplete(control.currentCandidate) ||
    !control.acceptedCandidate
  ) {
    return false;
  }
  return releaseCandidateMatches(control.currentCandidate, control.acceptedCandidate);
}

export function vitruviusAudienceCanAccessAskEcos(
  audience: VitruviusBetaAudience,
  control?: VitruviusAskEcosPilotControl | null,
): boolean {
  return audience === 'owner_internal' || outsidePilotAskEcosIsAccepted(control);
}

/**
 * Fail-closed beta authorization contract. Organization administrators retain
 * the current owner-supported workflow; every other user needs an active,
 * exactly scoped project membership before any project capability is allowed.
 */
export function evaluateVitruviusBetaAuthorization(input: Readonly<{
  userId: string;
  organizationId: string;
  projectId: string;
  permission: VitruviusProjectPermission;
  organizationMembership: VitruviusOrganizationMembership | null;
  projectMembership: VitruviusProjectMembership | null;
  askEcosPilotControl?: VitruviusAskEcosPilotControl | null;
}>): VitruviusBetaAuthorizationDecision {
  if (!nonEmpty(input.userId) || !nonEmpty(input.organizationId) || !nonEmpty(input.projectId)) {
    return deny('invalid_scope');
  }

  const organizationMembership = input.organizationMembership;
  if (
    !organizationMembership ||
    organizationMembership.userId !== input.userId ||
    organizationMembership.organizationId !== input.organizationId
  ) {
    return deny('organization_scope_mismatch');
  }
  if (organizationMembership.status !== 'active') {
    return deny('organization_membership_inactive');
  }
  if (organizationMembership.role === 'organization_admin') {
    return allow('active_organization_admin');
  }

  if (input.permission === 'ask_ecos') {
    if (!input.askEcosPilotControl || input.askEcosPilotControl.mode === 'disabled_for_pilot') {
      return deny('ask_ecos_disabled_for_pilot');
    }
    if (!outsidePilotAskEcosIsAccepted(input.askEcosPilotControl)) {
      return deny('ask_ecos_acceptance_missing_or_stale');
    }
  }

  const projectMembership = input.projectMembership;
  if (!projectMembership) return deny('project_membership_missing');
  if (
    projectMembership.userId !== input.userId ||
    projectMembership.organizationId !== input.organizationId ||
    projectMembership.projectId !== input.projectId
  ) {
    return deny('project_scope_mismatch');
  }
  if (projectMembership.status !== 'active') {
    return deny('project_membership_inactive');
  }
  if (!vitruviusProjectRoleHasPermission(projectMembership.role, input.permission)) {
    return deny('insufficient_project_role');
  }
  return allow('active_project_membership');
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function releaseCandidateIsComplete(candidate: VitruviusReleaseCandidateIdentity): boolean {
  return nonEmpty(candidate.version) &&
    nonEmpty(candidate.build) &&
    /^[0-9a-f]{7,40}$/i.test(candidate.sourceRevision);
}

function releaseCandidateMatches(
  current: VitruviusReleaseCandidateIdentity,
  accepted: VitruviusReleaseCandidateIdentity,
): boolean {
  return current.version === accepted.version &&
    current.build === accepted.build &&
    current.sourceRevision === accepted.sourceRevision;
}

function allow(reason: VitruviusBetaAuthorizationReason): VitruviusBetaAuthorizationDecision {
  return Object.freeze({ allowed: true, reason });
}

function deny(reason: VitruviusBetaAuthorizationReason): VitruviusBetaAuthorizationDecision {
  return Object.freeze({ allowed: false, reason });
}
