/**
 * Stable application-facing boundary for reporting.
 *
 * UI surfaces should import report contracts from this module instead of
 * depending directly on the internal report engine. Engine-to-engine imports
 * may continue to use PIEReporter while the service architecture is migrated.
 */
export type {
  PIEReportDraft,
  PIEReportType,
} from '../PIEReporter';
