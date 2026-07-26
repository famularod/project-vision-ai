import {
  createPIEDecisionHistoryActions,
  type PIEDecisionHistoryActions,
} from './PIEDecisionHistoryActions';
import {
  loadPIEDecisionLedgerForOrganization,
  savePIEDecisionLedgerForOrganization,
} from './PIEDecisionLedgerStorage';
import { queuePIEDecisionForSync } from './PIEDecisionLedgerSync';

/**
 * Runtime adapter for the pure Decision History action gate. Keeping the
 * AsyncStorage/Supabase queue imports here lets the core gate stay directly
 * testable without native-module mocks.
 */
export function createLocalPIEDecisionHistoryActions(): PIEDecisionHistoryActions {
  return createPIEDecisionHistoryActions({
    load: async organizationId =>
      (await loadPIEDecisionLedgerForOrganization(organizationId)).decisions,
    save: (organizationId, decisions) =>
      savePIEDecisionLedgerForOrganization(organizationId, [...decisions]),
    queue: decision => queuePIEDecisionForSync(decision),
  });
}
