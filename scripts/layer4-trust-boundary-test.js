#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const memoryStore = new Map();
const AsyncStorage = {
  getItem: async key => memoryStore.has(key) ? memoryStore.get(key) : null,
  setItem: async (key, value) => {
    memoryStore.set(key, value);
  },
  removeItem: async key => {
    memoryStore.delete(key);
  },
  getAllKeys: async () => Array.from(memoryStore.keys()),
};

function loadTs(relativePath, mocks = {}) {
  const fullPath = path.join(rootDir, relativePath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true,
      esModuleInterop: true,
    },
  });
  const sandbox = {
    exports: {},
    require: specifier => {
      if (specifier in mocks) return mocks[specifier];
      if (specifier === '@react-native-async-storage/async-storage') {
        return { __esModule: true, default: AsyncStorage };
      }
      return require(specifier);
    },
    console,
    Date,
    Object,
    JSON,
    RegExp,
    Set,
    Map,
    String,
    Number,
    Boolean,
    Error,
    Promise,
    Array,
  };
  vm.runInNewContext(compiled.outputText, sandbox, { filename: fullPath });
  return sandbox.exports;
}

const ledger = loadTs('services/PIEDecisionLedger.ts');
const storage = loadTs('services/PIEDecisionLedgerStorage.ts');

const actor = {
  id: 'user-1',
  name: 'User One',
  role: 'decision_owner',
  organizationId: 'org-1',
  authorizedPermissions: [
    'view_decision_history',
    'create_decision_snapshot',
    'approve_decision',
    'implement_decision',
    'record_outcome_plan',
    'record_implementation_assessment',
    'record_outcome',
    'append_corrected_version',
    'append_decision_version',
    'synchronize_decision_history',
  ],
  identitySource: 'supabase_auth',
  cloudTrusted: true,
};

const trustedIdentity = {
  actor,
  authenticatedUserId: actor.id,
  authenticatedEmail: 'user@example.com',
  displayName: actor.name,
  organizationId: 'org-1',
  roles: ['decision_owner'],
  permissions: actor.authorizedPermissions,
  identitySource: 'supabase_auth',
  organizationStatus: 'verified',
  membershipSource: 'organization_memberships',
  cloudTrusted: true,
  message: 'verified',
};

const untrustedIdentity = {
  ...trustedIdentity,
  cloudTrusted: false,
  organizationStatus: 'unverified',
};

function makeDecision(id = 'decision-1') {
  const prediction = ledger.buildPredictedOutcome({
    id: 'prediction-1',
    description: 'Inspection status is verified',
    measurableResult: 'Inspection status confirmed',
    baseline: 'Unknown',
    targetValue: 'Verified',
    expectedDirection: 'verify',
    expectedReviewDate: '2026-07-08T12:00:00.000Z',
    evidenceRequired: ['Current photo'],
    responsibleOwner: 'User One',
    validationAuthority: 'User One',
    predictionConfidence: 'medium',
    rationale: 'Current evidence should verify the decision.',
  });
  return ledger.createDecisionRecord({
    id,
    organizationId: 'org-1',
    projectId: 'project-1',
    createdBy: actor,
    createdAt: '2026-07-01T12:00:00.000Z',
    snapshot: {
      projectId: 'project-1',
      situationId: 'situation-1',
      issueId: null,
      recommendationId: 'recommendation-1',
      selectedOption: 'Verify inspection status',
      decisionOwner: 'User One',
      decisionAuthority: 'User One',
      decisionDate: '2026-07-01T12:00:00.000Z',
      evidenceAvailable: [{
        id: 'photo-1',
        sourceType: 'photo',
        organizationId: 'org-1',
        projectId: 'project-1',
        summary: 'Current photo',
        capturedAt: '2026-07-01T12:00:00.000Z',
      }],
      knownEvidenceGaps: [],
      assumptions: ['Photo is current'],
      risks: ['Status may be overstated without review'],
      constraints: ['No automatic closeout'],
      predictedOutcomes: [prediction],
      recommendationConfidence: 'medium',
      confidenceExplanation: 'Current evidence exists but outcome still needs verification.',
      selectedReason: 'This action reduces uncertainty.',
    },
  });
}

(async () => {
  const identity = loadTs('services/PIELayer4Identity.ts', {
    './SupabaseService': {
      getCurrentUser: async () => ({
        ok: true,
        configured: true,
        data: {
          id: 'auth-user-1',
          email: 'auth@example.com',
          user_metadata: { full_name: 'Authenticated User' },
        },
      }),
      getSupabaseClient: () => ({
        from: table => {
          assert.strictEqual(table, 'organization_memberships');
          return {
            select: columns => {
              assert.strictEqual(columns, 'organization_id, role, status');
              return {
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: {
                          organization_id: 'org-verified',
                          role: 'validation_authority',
                          status: 'active',
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              };
            },
          };
        },
      }),
    },
  });
  const resolved = await identity.resolvePIELayer4ActorContext();
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.context.authenticatedUserId, 'auth-user-1');
  assert.strictEqual(resolved.context.organizationId, 'org-verified');
  assert.strictEqual(resolved.context.cloudTrusted, true);
  assert(resolved.context.permissions.includes('validate_outcome'));
  assert(resolved.context.permissions.includes('synchronize_decision_history'));
  assert.notStrictEqual(resolved.context.actor.id, 'local-user');
  assert.notStrictEqual(resolved.context.actor.organizationId, 'local-organization');

  const inactiveIdentity = loadTs('services/PIELayer4Identity.ts', {
    './SupabaseService': {
      getCurrentUser: async () => ({
        ok: true,
        configured: true,
        data: {
          id: 'auth-user-2',
          email: 'inactive@example.com',
          user_metadata: {},
        },
      }),
      getSupabaseClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    },
  });
  const inactiveResolved = await inactiveIdentity.resolvePIELayer4ActorContext();
  assert.strictEqual(inactiveResolved.context.cloudTrusted, false);
  assert.strictEqual(inactiveResolved.context.organizationStatus, 'unverified');
  assert(!inactiveResolved.context.permissions.includes('validate_outcome'));
  assert(!inactiveResolved.context.permissions.includes('close_decision'));

  const invalidRoleIdentity = loadTs('services/PIELayer4Identity.ts', {
    './SupabaseService': {
      getCurrentUser: async () => ({
        ok: true,
        configured: true,
        data: {
          id: 'auth-user-invalid-role',
          email: 'invalid-role@example.com',
          user_metadata: {},
        },
      }),
      getSupabaseClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      organization_id: 'org-untrusted',
                      role: 'unknown_role',
                      status: 'active',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    },
  });
  const invalidRoleResolved = await invalidRoleIdentity.resolvePIELayer4ActorContext();
  assert.strictEqual(invalidRoleResolved.ok, false);
  assert.strictEqual(invalidRoleResolved.context.cloudTrusted, false);
  assert.strictEqual(invalidRoleResolved.context.organizationStatus, 'unverified');
  assert.match(invalidRoleResolved.error, /recognized Layer 4 role/i);

  const decision = makeDecision();

  assert.throws(
    () => ledger.createDecisionRecord({
      id: 'denied',
      organizationId: 'org-1',
      projectId: 'project-1',
      createdBy: { ...actor, authorizedPermissions: [] },
      snapshot: decision.immutableSnapshot,
    }),
    /permission denied/i,
  );

  await AsyncStorage.setItem(
    storage.DECISION_LEDGER_LEGACY_STORAGE_KEY,
    JSON.stringify([decision]),
  );
  const loaded = await storage.loadPIEDecisionLedgerForOrganization('org-1');
  assert.strictEqual(loaded.decisions.length, 0);
  assert.strictEqual(loaded.migrationStatus.quarantinedRecords, 1);
  assert.strictEqual(await AsyncStorage.getItem(storage.DECISION_LEDGER_LEGACY_STORAGE_KEY), null);

  await storage.savePIEDecisionLedgerForOrganization('org-1', [decision]);
  const orgOne = await storage.loadPIEDecisionLedgerForOrganization('org-1');
  const orgTwo = await storage.loadPIEDecisionLedgerForOrganization('org-2');
  assert.strictEqual(orgOne.decisions.length, 1);
  assert.strictEqual(orgTwo.decisions.length, 0);

  let savedCount = 0;
  const sync = loadTs('services/PIEDecisionLedgerSync.ts', {
    './PIELayer4Identity': {
      assertLayer4CloudTrusted: identity => {
        if (!identity.cloudTrusted) throw new Error('untrusted identity');
      },
      hasLayer4Permission: (identity, permission) =>
        identity.permissions.includes(permission),
    },
    './SupabaseService': {
      listPIEDecisionRecords: async () => ({ ok: true, configured: true, data: [] }),
      savePIEDecisionRecordAtomic: async () => {
        savedCount += 1;
        return { ok: true, configured: true, data: decision };
      },
    },
  });

  await sync.queuePIEDecisionForSync(decision);
  await sync.queuePIEDecisionForSync(decision);
  const result = await sync.syncPIEDecisionLedger({
    decisions: [decision],
    identity: trustedIdentity,
  });
  assert.strictEqual(result.uploaded, 1);
  assert.strictEqual(savedCount, 1);

  const untrustedResult = await sync.syncPIEDecisionLedger({
    decisions: [decision],
    identity: untrustedIdentity,
  });
  assert.strictEqual(untrustedResult.uploaded, 0);
  assert.match(untrustedResult.errors[0], /untrusted identity/i);

  const noSyncPermissionResult = await sync.syncPIEDecisionLedger({
    decisions: [decision],
    identity: {
      ...trustedIdentity,
      permissions: trustedIdentity.permissions.filter(permission => permission !== 'synchronize_decision_history'),
    },
  });
  assert.strictEqual(noSyncPermissionResult.uploaded, 0);
  assert.match(noSyncPermissionResult.errors[0], /synchronize_decision_history/i);

  const remoteConflict = {
    ...decision,
    immutableSnapshot: {
      ...decision.immutableSnapshot,
      selectedOption: 'Different cloud snapshot',
    },
  };
  const conflict = sync.detectDecisionSyncConflict(decision, remoteConflict);
  assert(conflict);
  assert.strictEqual(conflict.field, 'immutableSnapshot');

  console.log('Layer 4 trust boundary tests passed.');
})();
