/**
 * N761d (open item 7.61, 15 Oct 2026): "Report check details", a DIAGNOSTIC. Two devices holding the same records
 * must work out the same fingerprint of a report; where they do not, the computer offers Approve for a report the
 * phone already sent. This writes out, as text, every part the fingerprint is made of (buildDAVEReportSourceOnPeriod's
 * parts: the format, the report it is counted from, each project's records as hashed, record by record and field by
 * field, and what the report prints, line by line), each with the short hash the fingerprint gives it, then the period
 * it was worked out on and what the fingerprint leaves out (only to explain a difference). The same records give the
 * same text on the phone and on the computer, so the first line that differs between the two texts names the record
 * and the field.
 *
 * The phone: Settings > Report check details copies the text of the report last opened in Reports to the clipboard
 * (and only there). The computer: Reports > Review & Prepare Report > Details shows the same text.
 * Nothing here sends, saves or uploads anything, and no fingerprint, report or period changes. The text holds no
 * secrets: a value that is a link, an e-mail address, a key or a token, or is filed under such a name, is written as
 * its hash only (a difference still shows).
 */
import type { DAVEProjectTruth } from './DAVEProjectTruth';
import { daveReportPartHash, daveReportSourceParts } from './DAVEReportIntelligence';
import { sameReportSource, type DAVEReportFormat, type DAVEReportSnapshot } from './DAVEReportSnapshot';
import type { DAVEReportSharedCheck } from './DAVEReportSnapshotStore';

export const DAVE_REPORT_CHECK_DETAILS_VERSION = 'report-check/1' as const;

export type DAVEReportCheckInput = Readonly<{
  truths: readonly DAVEProjectTruth[];
  /** The period the screen's fingerprint is worked out on (null: none, or not read yet). */
  period: DAVEReportSnapshot | null | undefined;
  format: DAVEReportFormat;
  /** Whether the screen had read the period yet ('loading': its fingerprint is worked out with none). */
  periodState?: 'read' | 'loading';
  /** Whether the shared copy of the period was checked. */
  shared?: DAVEReportSharedCheck;
}>;

/** A leaf value longer than this is cut, with the hash of the whole value. */
const LONGEST_VALUE = 240;

export function buildDAVEReportCheckDetails(input: DAVEReportCheckInput): string {
  const parts = daveReportSourceParts(input.truths, input.period, input.format);
  const lines: string[] = [];
  const add = (line: string) => lines.push(line);
  const periodState = input.periodState ?? 'read';
  add(`REPORT CHECK DETAILS (${DAVE_REPORT_CHECK_DETAILS_VERSION}). Made on this device from the records it holds. Nothing was sent.`);
  add('Compare with the other device\'s text line by line: the first line that differs names the record and the field.');
  add(`day: ${localDay(new Date())}`);
  add(`format: ${parts.format}`);
  add(`projects: ${JSON.stringify(parts.projects.map(project => safeText(project.name)))}`);
  add(`period: ${periodState === 'read' ? `read (shared copy: ${input.shared ?? 'unknown'})` : 'not read yet (worked out with none)'}`);
  add(`fingerprint: ${parts.fingerprint}`);
  add(`parts make the fingerprint: ${parts.partsMakeTheFingerprint ? 'yes' : 'NO'}`);
  // Whether this IS the period's last report (approved or sent): where it was sent, the screen says it was sent.
  add(`the period's own report: ${parts.period ? (sameReportSource(parts.period.sourceFingerprint, parts.fingerprint) ? 'yes' : 'no') : 'no period'}`);

  add(`== 1 FORMAT #${daveReportPartHash(parts.format)} = ${JSON.stringify(parts.format)}`);

  add(`== 2 COUNTED FROM #${daveReportPartHash(parts.countedFromPart)}`);
  writeValue(add, 'countedFrom', parts.countedFromPart, { sortByLabel: false });

  add(`== 3 PROJECTS #${parts.projectsHash} (each project's records as the fingerprint hashes them)`);
  for (const project of parts.projects) {
    writeValue(add, `projects.${JSON.stringify(safeText(project.projectName))}`, project.facts, { sortByLabel: true, hash: project.hash });
  }

  add(`== 4 PRINTED #${daveReportPartHash(parts.printed)} (what the report prints, as the fingerprint holds it)`);
  writeValue(add, 'printed', parts.printed, { sortByLabel: false });

  add('== 5 PERIOD (the shared record this report is worked out on; not hashed itself)');
  writeValue(add, 'period', snapshotSummary(parts.period), { sortByLabel: true, maxDepth: 4 });
  writeValue(add, 'countedFromReport', snapshotSummary(parts.countedFrom), { sortByLabel: true, maxDepth: 4 });

  add('== 6 NOT HASHED (left out of the fingerprint; only to explain a difference above)');
  for (const project of parts.projects) {
    // The records in full; Project Truth's own reading (worked out from them) two levels deep, to show which part moved.
    const { intelligence, reasoning, briefing, verificationQueue, ...records } = project.notHashed as Record<string, unknown>;
    const path = `notHashed.${JSON.stringify(safeText(project.projectName))}`;
    writeValue(add, path, records, { sortByLabel: true });
    writeValue(add, `${path}.reading`, { intelligence, reasoning, briefing, verificationQueue }, { sortByLabel: true, maxDepth: 2 });
  }
  add(`END (${lines.length + 1} lines)`);
  return lines.join('\n');
}

/** A report snapshot as the check writes it: its own facts, its tasks, and only the name of the report it replaced. */
function snapshotSummary(snapshot: DAVEReportSnapshot | null): unknown {
  if (!snapshot) return null;
  const { supersedes, ...rest } = snapshot;
  return {
    ...rest,
    supersedes: supersedes
      ? { report: supersedes.sourceFingerprint, sentAt: supersedes.deliveredAt ?? null, capturedAt: supersedes.capturedAt, hash: daveReportPartHash(supersedes) }
      : null,
  };
}

type WriteOptions = Readonly<{ sortByLabel: boolean; maxDepth?: number; hash?: string }>;

/**
 * One value as lines, each with its full path, so a line that differs between two texts says by itself which record
 * and which field: an object or a list as a line with its hash (and how many items), then its parts; a plain value as
 * "<path> = <value>". A list's items are named by their id where they have one ([taskId=paint]).
 */
function writeValue(add: (line: string) => void, path: string, value: unknown, options: WriteOptions, depth = 0, key = ''): void {
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  if (Array.isArray(value)) {
    add(`${path}: ${value.length} #${depth === 0 && options.hash ? options.hash : daveReportPartHash(value)}`);
    if (value.length === 0 || depth >= maxDepth) return;
    const named = value.map((item, index) => ({ item, label: itemLabel(item, index) }));
    const seen = new Map<string, number>();
    const items = named.map(entry => {
      const count = (seen.get(entry.label) ?? 0) + 1;
      seen.set(entry.label, count);
      return { ...entry, label: count > 1 ? `${entry.label}~${count}` : entry.label };
    });
    if (options.sortByLabel) items.sort((left, right) => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0));
    for (const { item, label } of items) writeValue(add, `${path}[${label}]`, item, options, depth + 1, key);
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    add(`${path} #${depth === 0 && options.hash ? options.hash : daveReportPartHash(value)}`);
    if (depth >= maxDepth) return;
    for (const [childKey, child] of entries) writeValue(add, `${path}.${safeLabel(childKey)}`, child, options, depth + 1, childKey);
    return;
  }
  add(`${path} = ${leafText(key, value)}`);
}

const ID_KEYS = ['id', 'taskId', 'updateId', 'photoId', 'documentId', 'sourceRecordId', 'projectName', 'name', 'taskName'] as const;

function itemLabel(item: unknown, index: number): string {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    for (const idKey of ID_KEYS) {
      const id = record[idKey];
      if (typeof id === 'string' && id.trim()) return `${idKey}=${safeLabel(id)}`;
    }
    return `#${daveReportPartHash(item)}`;
  }
  return String(index);
}

function leafText(key: string, value: unknown): string {
  if (typeof value === 'string' && value && SECRET_NAME.test(key)) return `<hidden #${daveReportPartHash(value)}>`;
  const text = JSON.stringify(typeof value === 'string' ? safeText(value) : value) ?? 'undefined';
  if (text.length <= LONGEST_VALUE) return text;
  return `${text.slice(0, LONGEST_VALUE)}... (${text.length} chars #${daveReportPartHash(value)})`;
}

function safeLabel(value: string): string {
  const text = safeText(value);
  return /^[\w\-:./ ]+$/.test(text) ? text : JSON.stringify(text);
}

/** A field filed under one of these names is written as its hash only. */
const SECRET_NAME = /pass(word|phrase)|secret|token|api[_-]?key|auth(orization)?$|credential|cookie|signature|private[_-]?key|access[_-]?key|session[_-]?(id|key)/i;

/**
 * Text with every link, e-mail address, signed or bearer token, key and long secret-like run written as its hash.
 * The hash is the fingerprint's own short hash: it says whether two values are the same, never what they are.
 */
export function safeText(value: string): string {
  const hidden = (kind: string) => (match: string) => `<${kind} #${daveReportPartHash(match)}>`;
  return value
    .replace(/\b(?:https?|wss?|file|content|ph|assets-library|blob|data|s3|gs):[^\s"'<>]+/gi, hidden('link'))
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, hidden('email'))
    .replace(/\beyJ[\w-]{6,}\.[\w-]{6,}(?:\.[\w-]*)?/g, hidden('hidden'))
    .replace(/\bBearer\s+\S+/gi, hidden('hidden'))
    .replace(/\b(?:(?:sk|pk|rk)[-_](?:live|test)?[-_]?[A-Za-z0-9]{16,}|sb_(?:secret|publishable)_[\w-]+|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16})/g, hidden('hidden'))
    .replace(/(?=[A-Za-z0-9+/_=]*\d)(?=[A-Za-z0-9+/_=]*[A-Za-z])[A-Za-z0-9+/_=]{40,}/g, hidden('hidden'));
}

function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The phone: the Reports screen holds what its fingerprint was last worked out from; Settings copies its text.
// ---------------------------------------------------------------------------------------------------------------

let held: DAVEReportCheckInput | null = null;

/** The phone's Reports screen, whenever its fingerprint's inputs change: the same truths, period and format. */
export function holdDAVEReportCheckInput(input: DAVEReportCheckInput): void {
  held = input;
}

export function heldDAVEReportCheckInput(): DAVEReportCheckInput | null {
  return held;
}

export function forgetDAVEReportCheckInput(): void {
  held = null;
}

export type DAVEReportCheckCopy =
  | Readonly<{ copied: false; reason: 'nothing_held' | 'copy_failed' }>
  | Readonly<{ copied: true; projects: readonly string[]; format: DAVEReportFormat; lines: number }>;

/**
 * Settings > Report check details: the text of the report last opened in Reports, put on this device's clipboard by
 * `copy` (expo-clipboard). Nothing else: nothing is sent, saved or uploaded.
 */
export async function copyDAVEReportCheckDetails(copy: (text: string) => Promise<unknown>): Promise<DAVEReportCheckCopy> {
  const input = held;
  if (!input) return { copied: false, reason: 'nothing_held' };
  const text = buildDAVEReportCheckDetails(input);
  try {
    await copy(text);
  } catch {
    return { copied: false, reason: 'copy_failed' };
  }
  return {
    copied: true,
    projects: [...input.truths.map(truth => truth.projectName)].sort((left, right) => left.localeCompare(right)),
    format: input.format,
    lines: text.split('\n').length,
  };
}
