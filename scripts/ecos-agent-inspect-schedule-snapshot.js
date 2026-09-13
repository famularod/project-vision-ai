#!/usr/bin/env node

const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const PROJECT_NAMES = process.argv.slice(2);
const SEARCH_TERMS = [
  "FORM & PLACE FOOTINGS",
  "RFI 11",
  "SOUTH LOT",
  "HAZARDOUS",
  "CANOPY",
];

async function main() {
  if (PROJECT_NAMES.length === 0) {
    throw new Error("At least one exact project name is required.");
  }
  const client = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const projects = await exactProjects(client, PROJECT_NAMES);
  const { data, error } = await client
    .from("schedule_items")
    .select("id,project_name,task_name,item_data,updated_at")
    .in("project_name", PROJECT_NAMES)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const rows = (data || []).map(normalizeRow);
  const selected = rows.filter((row) => {
    const searchable = stableStringify(row).toUpperCase();
    return SEARCH_TERMS.some((term) => searchable.includes(term));
  });
  const inProgressRows = rows.filter((row) =>
    row.status.toLowerCase() === "in progress" ||
    (row.percentComplete > 0 && row.percentComplete < 100)
  );
  const rowsWithDependencies = rows.filter((row) =>
    row.dependencies.length > 0
  );
  const keyCounts = new Map();
  for (const row of data || []) {
    for (const key of Object.keys(record(row.item_data))) {
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }
  }
  const receipt = {
    schemaVersion: "ecos-agent-schedule-snapshot-inspection/1.0",
    capturedAt: new Date().toISOString(),
    projectIdentities: projects.map((project) => ({
      name: project.name,
      idSha256: sha256(project.id),
      ownerIdSha256: sha256(project.owner_id),
    })),
    totalRows: rows.length,
    rowsByProject: Object.fromEntries(PROJECT_NAMES.map((name) => [
      name,
      rows.filter((row) => row.projectName === name).length,
    ])),
    itemDataKeyCounts: Object.fromEntries([...keyCounts].sort()),
    statusCounts: countBy(rows, (row) => row.status || "Unknown"),
    inProgressRows,
    dependencyRowCount: rowsWithDependencies.length,
    dependencyRows: rowsWithDependencies,
    targetRows: selected,
    snapshotSha256: sha256(stableStringify(rows)),
  };
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

async function exactProjects(client, names) {
  const { data, error } = await client
    .from("projects")
    .select("id,name,owner_id,archived")
    .eq("archived", false)
    .in("name", names);
  if (error) throw error;
  const rows = data || [];
  for (const name of names) {
    if (rows.filter((row) => text(row.name) === name).length !== 1) {
      throw new Error(`Exact active project identity is not unique: ${name}`);
    }
  }
  const ownerIds = new Set(rows.map((row) => text(row.owner_id)));
  if (ownerIds.size !== 1) {
    throw new Error("Exact projects do not share one owner.");
  }
  return rows;
}

function normalizeRow(row) {
  const data = record(row.item_data);
  const value = {
    idSha256: sha256(text(row.id)),
    projectName: text(row.project_name),
    taskName: text(data.taskName) || text(row.task_name),
    activity: text(data.activity),
    itemType: text(data.itemType),
    wbsCode: text(data.wbsCode) || text(data.sourceWbsCode),
    parentItemIdSha256: text(data.parentItemId)
      ? sha256(text(data.parentItemId))
      : null,
    locationName: text(data.locationName),
    status: text(data.status),
    percentComplete: numberOrNull(data.percentComplete),
    startDate: text(data.startDate) || null,
    finishDate: text(data.finishDate) || null,
    actualStart: text(data.actualStart) || null,
    actualFinish: text(data.actualFinish) || null,
    dependencies: normalizeDependencies(data.dependencies),
    isCritical: booleanOrNull(data.isCritical),
    isMilestone: booleanOrNull(data.isMilestone),
    isSummary: booleanOrNull(data.isSummary),
    updatedAt: text(row.updated_at) || null,
  };
  return value;
}

function normalizeDependencies(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((dependency) => {
    if (typeof dependency === "string" || typeof dependency === "number") {
      return { sourceActivityId: String(dependency), type: null, lag: null };
    }
    const entry = record(dependency);
    return {
      sourceActivityId: text(entry.sourceActivityId) ||
        text(entry.predecessorId) || text(entry.id) || null,
      type: text(entry.type) || text(entry.relationshipType) || null,
      lag: text(entry.lag) || text(entry.lagDays) || null,
    };
  });
}

function countBy(values, keyFor) {
  const counts = new Map();
  for (const value of values) {
    const key = keyFor(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts].sort());
}

function required(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${
      Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value) ?? "null";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
