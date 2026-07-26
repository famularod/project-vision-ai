import type { User } from '@supabase/supabase-js';
import {
  getCurrentUser,
  getSupabaseClient,
} from './SupabaseService';
import type {
  PIEActor,
  PIEActorRole,
  PIELayer4Permission,
} from './PIEDecisionLedger';

export type PIELayer4Role =
  | 'member'
  | 'project_manager'
  | 'decision_owner'
  | 'validation_authority'
  | 'organization_admin';

export type PIELayer4IdentitySource =
  | 'supabase_auth'
  | 'offline_fallback'
  | 'unavailable';

export type PIELayer4OrganizationStatus =
  | 'verified'
  | 'unverified'
  | 'missing_membership_schema'
  | 'unavailable';

export type PIELayer4ActorContext = {
  actor: PIEActor;
  authenticatedUserId: string | null;
  authenticatedEmail: string | null;
  displayName: string;
  organizationId: string;
  roles: PIELayer4Role[];
  permissions: PIELayer4Permission[];
  identitySource: PIELayer4IdentitySource;
  organizationStatus: PIELayer4OrganizationStatus;
  membershipSource: string;
  cloudTrusted: boolean;
  message: string;
};

export type PIELayer4IdentityResolution = {
  ok: boolean;
  context: PIELayer4ActorContext;
  error?: string;
};

type MembershipRow = {
  organization_id?: unknown;
  role?: unknown;
  status?: unknown;
};

const ORGANIZATION_MEMBERSHIPS_TABLE = 'organization_memberships';

const ROLE_PERMISSIONS: Record<PIELayer4Role, PIELayer4Permission[]> = {
  member: ['view_decision_history'],
  project_manager: [
    'view_decision_history',
    'create_decision_candidate',
    'create_decision_snapshot',
    'record_outcome_plan',
    'record_implementation_assessment',
    'record_outcome',
    'append_corrected_version',
    'append_decision_version',
    'synchronize_decision_history',
  ],
  decision_owner: [
    'view_decision_history',
    'create_decision_candidate',
    'create_decision_snapshot',
    'approve_decision',
    'reject_decision',
    'defer_decision',
    'implement_decision',
    'cancel_decision',
    'record_outcome_plan',
    'record_implementation_assessment',
    'record_outcome',
    'close_decision',
    'append_corrected_version',
    'append_decision_version',
    'synchronize_decision_history',
  ],
  validation_authority: [
    'view_decision_history',
    'record_outcome',
    'validate_outcome',
    'dispute_outcome',
    'close_decision',
    'append_corrected_version',
    'append_decision_version',
    'synchronize_decision_history',
  ],
  organization_admin: [
    'view_decision_history',
    'create_decision_candidate',
    'create_decision_snapshot',
    'approve_decision',
    'reject_decision',
    'defer_decision',
    'implement_decision',
    'cancel_decision',
    'record_outcome_plan',
    'record_implementation_assessment',
    'record_outcome',
    'validate_outcome',
    'dispute_outcome',
    'close_decision',
    'append_corrected_version',
    'append_decision_version',
    'synchronize_decision_history',
  ],
};

const PERMISSION_ACTOR_ROLE: Partial<Record<PIELayer4Permission, PIEActorRole>> = {
  approve_decision: 'decision_owner',
  reject_decision: 'decision_owner',
  defer_decision: 'decision_owner',
  implement_decision: 'decision_owner',
  cancel_decision: 'decision_owner',
  close_decision: 'decision_owner',
  validate_outcome: 'validation_authority',
  dispute_outcome: 'validation_authority',
  record_outcome_plan: 'decision_owner',
  record_implementation_assessment: 'decision_owner',
};

export async function resolvePIELayer4ActorContext(): Promise<PIELayer4IdentityResolution> {
  const userResult = await getCurrentUser();

  if (!userResult.ok || !userResult.data) {
    const context = fallbackContext(null, null, userResult.error || userResult.message);
    return {
      ok: false,
      context,
      error: context.message,
    };
  }

  const user = userResult.data;
  const membership = await resolveMembership(user.id);
  const displayName = displayNameForUser(user);

  if (!membership.ok) {
    const context = fallbackContext(user.id, user.email || null, membership.error);
    return {
      ok: false,
      context: {
        ...context,
        displayName,
        actor: {
          ...context.actor,
          id: user.id,
          name: displayName,
        },
        identitySource: 'supabase_auth',
        authenticatedUserId: user.id,
        authenticatedEmail: user.email || null,
        organizationStatus: membership.status,
        membershipSource: membership.source,
        message: membership.error,
      },
      error: membership.error,
    };
  }

  const roles = membership.roles;
  const permissions = permissionsForRoles(roles);
  const actor: PIEActor = {
    id: user.id,
    name: displayName,
    role: actorRoleForRoles(roles),
    organizationId: membership.organizationId,
    authorizedPermissions: permissions,
    identitySource: 'supabase_auth',
    cloudTrusted: true,
  };

  return {
    ok: true,
    context: {
      actor,
      authenticatedUserId: user.id,
      authenticatedEmail: user.email || null,
      displayName,
      organizationId: membership.organizationId,
      roles,
      permissions,
      identitySource: 'supabase_auth',
      organizationStatus: 'verified',
      membershipSource: membership.source,
      cloudTrusted: true,
      message: 'Layer 4 identity is verified through Supabase Auth and active organization membership.',
    },
  };
}

export function actorForLayer4Permission(
  context: PIELayer4ActorContext,
  permission: PIELayer4Permission,
): PIEActor {
  if (!hasLayer4Permission(context, permission)) {
    throw new Error(`Layer 4 permission denied: ${permission}.`);
  }

  const role = PERMISSION_ACTOR_ROLE[permission] || context.actor.role;

  return {
    ...context.actor,
    role,
    authorizedPermissions: context.permissions,
    identitySource: context.identitySource,
    cloudTrusted: context.cloudTrusted,
  };
}

export function hasLayer4Permission(
  context: PIELayer4ActorContext | null | undefined,
  permission: PIELayer4Permission,
): boolean {
  return Boolean(context?.permissions.includes(permission));
}

export function assertLayer4CloudTrusted(context: PIELayer4ActorContext): void {
  if (!context.cloudTrusted || context.organizationStatus !== 'verified') {
    throw new Error('Layer 4 cloud sync requires authenticated identity and verified organization membership.');
  }
}

export function permissionsForRoles(roles: PIELayer4Role[]): PIELayer4Permission[] {
  return Array.from(
    new Set(roles.flatMap(role => ROLE_PERMISSIONS[role] || [])),
  );
}

function actorRoleForRoles(roles: PIELayer4Role[]): PIEActorRole {
  if (roles.includes('organization_admin')) return 'admin';
  if (roles.includes('validation_authority')) return 'validation_authority';
  if (roles.includes('decision_owner')) return 'decision_owner';
  return 'user';
}

async function resolveMembership(userId: string): Promise<{
  ok: true;
  organizationId: string;
  roles: PIELayer4Role[];
  source: string;
} | {
  ok: false;
  status: PIELayer4OrganizationStatus;
  source: string;
  error: string;
}> {
  const client = getSupabaseClient();

  if (!client) {
    return {
      ok: false,
      status: 'unavailable',
      source: 'supabase_unconfigured',
      error: 'Supabase is not configured, so organization membership cannot be verified.',
    };
  }

  const { data, error } = await client
    .from(ORGANIZATION_MEMBERSHIPS_TABLE)
    .select('organization_id, role, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: /does not exist|schema cache|relation/i.test(error.message)
        ? 'missing_membership_schema'
        : 'unavailable',
      source: ORGANIZATION_MEMBERSHIPS_TABLE,
      error: `Organization membership could not be verified: ${error.message}`,
    };
  }

  const row = data as MembershipRow | null;
  const organizationId =
    typeof row?.organization_id === 'string' ? row.organization_id.trim() : '';

  if (!organizationId) {
    return {
      ok: false,
      status: 'unverified',
      source: ORGANIZATION_MEMBERSHIPS_TABLE,
      error: 'No active organization membership was found for the authenticated user.',
    };
  }

  const role = normalizeRole(row?.role);
  if (!role) {
    return {
      ok: false,
      status: 'unverified',
      source: ORGANIZATION_MEMBERSHIPS_TABLE,
      error: 'The active organization membership has no recognized Layer 4 role.',
    };
  }

  return {
    ok: true,
    organizationId,
    roles: [role],
    source: ORGANIZATION_MEMBERSHIPS_TABLE,
  };
}

function normalizeRole(value: unknown): PIELayer4Role | null {
  if (typeof value !== 'string') return null;
  const role = value.trim();
  return ['member', 'project_manager', 'decision_owner', 'validation_authority', 'organization_admin'].includes(role)
    ? role as PIELayer4Role
    : null;
}

function fallbackContext(
  authenticatedUserId: string | null,
  authenticatedEmail: string | null,
  reason?: string,
): PIELayer4ActorContext {
  const userSuffix = authenticatedUserId || 'anonymous';
  const organizationId = `local-unverified-${userSuffix}`;
  const permissions: PIELayer4Permission[] = [
    'view_decision_history',
    'create_decision_candidate',
    'create_decision_snapshot',
    'append_corrected_version',
    'append_decision_version',
  ];
  const actor: PIEActor = {
    id: authenticatedUserId || 'offline-user',
    name: authenticatedEmail || 'Offline User',
    role: 'user',
    organizationId,
    authorizedPermissions: permissions,
    identitySource: authenticatedUserId ? 'supabase_auth' : 'offline_fallback',
    cloudTrusted: false,
  };

  return {
    actor,
    authenticatedUserId,
    authenticatedEmail,
    displayName: actor.name,
    organizationId,
    roles: ['member'],
    permissions,
    identitySource: actor.identitySource || 'offline_fallback',
    organizationStatus: 'unverified',
    membershipSource: 'local_fallback',
    cloudTrusted: false,
    message: reason || 'Layer 4 is using local-only identity until organization membership is verified.',
  };
}

function displayNameForUser(user: User): string {
  const metadata = user.user_metadata || {};
  const accountName =
    typeof metadata.project_vision_display_name === 'string'
      ? metadata.project_vision_display_name.trim()
      : '';
  const fullName =
    typeof metadata.full_name === 'string' ? metadata.full_name.trim() : '';
  const name = typeof metadata.name === 'string' ? metadata.name.trim() : '';
  return accountName || fullName || name || user.email || user.id;
}
