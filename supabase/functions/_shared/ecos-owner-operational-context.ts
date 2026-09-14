import {
  assertECOSProjectRecordInventory,
  buildECOSProjectRecordObservations,
  type ECOSProjectRecordInventory,
} from "./ecos-project-record-inventory.ts";
import {
  assertECOSOperationalRecordDiscovery,
  type ECOSOperationalRecordDiscovery,
} from "./ecos-operational-record-discovery.ts";
import { copyECOSV2JSON } from "./ecos-v2-json-model.ts";

export interface ECOSOwnerOperationalSelection {
  readonly source_key: string;
  readonly source_sha256: string;
}
const origins = new WeakMap<object, {
  records: ECOSProjectRecordInventory;
  discovery: ECOSOperationalRecordDiscovery;
  query: string;
}>();
function freeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function fail(): never {
  throw new Error("Genuine exact owner operational context required");
}
/** The scope must come from the authenticated owner handler. Missing embedded
 * organization metadata is not a name-based grant: the existing SQL inventory
 * enforces exact physical owner/project, membership and embedded scope parity.
 * Only genuine recorded scalar projections become citeable. Whole returned
 * records, including unselected opposing records, remain untrusted context. */
export function createECOSOwnerOperationalContext(
  records: ECOSProjectRecordInventory,
  discovery: ECOSOperationalRecordDiscovery,
  query: string,
  selections: readonly ECOSOwnerOperationalSelection[],
) {
  assertECOSProjectRecordInventory(records);
  assertECOSOperationalRecordDiscovery(discovery, records, query);
  if (records.organization_id !== records.owner_id) return fail();
  const selected = copyECOSV2JSON(
    selections,
    8192,
  ) as ECOSOwnerOperationalSelection[];
  if (!Array.isArray(selected) || selected.length > 8) return fail();
  const keys = new Set<string>();
  for (const s of selected) {
    if (
      !s || Object.keys(s).sort().join(",") !== "source_key,source_sha256" ||
      typeof s.source_key !== "string" || keys.has(s.source_key) ||
      !discovery.candidates.some((c) =>
        c.row.source_key === s.source_key &&
        c.row.source_sha256 === s.source_sha256
      )
    ) return fail();
    keys.add(s.source_key);
  }
  const context = freeze({
    organization_id: records.organization_id,
    owner_id: records.owner_id,
    project_id: records.project_id,
    query,
    record_epoch_sha256: records.epoch_sha256,
    discovery_sha256: discovery.discovery_sha256,
    candidates: discovery.candidates,
    observations: buildECOSProjectRecordObservations(records).observations
      .filter((o) => keys.has(o.source_key)),
    coverage: {
      state: "loaded_exact_project_records" as const,
      record_epoch_sha256: records.epoch_sha256,
      discovery_sha256: discovery.discovery_sha256,
      ...discovery.coverage,
      selected_record_count: selected.length,
      selected_records: selected,
      row_gaps: records.rows.filter((r) => r.disposition !== "recorded").map((
        r,
      ) => ({
        source_key: r.source_key,
        disposition: r.disposition as "needs_review" | "deleted_conflict",
        limitations: r.limitations,
      })),
      aggregate_progress: "not_computed" as const,
      legacy_name_scope: "not_assessed" as const,
      local_unsynced_records: "not_assessed" as const,
    },
  });
  // This is a whole-context bound, never a successful prefix or clipped note.
  if (new TextEncoder().encode(JSON.stringify(context)).length > 96 * 1024) {
    return fail();
  }
  origins.set(context, { records, discovery, query });
  return context;
}
export type ECOSOwnerOperationalContext = ReturnType<
  typeof createECOSOwnerOperationalContext
>;
export function assertECOSOwnerOperationalContext(
  value: unknown,
): asserts value is ECOSOwnerOperationalContext {
  if (!value || typeof value !== "object" || !origins.has(value)) return fail();
}
