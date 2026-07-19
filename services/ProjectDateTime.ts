declare const plainDateBrand: unique symbol;
declare const instantBrand: unique symbol;
declare const projectTimeZoneBrand: unique symbol;

/** A calendar date without a time or UTC offset. */
export type PlainDate = string & { readonly [plainDateBrand]: 'PlainDate' };

/** An absolute timestamp with an explicit UTC offset. */
export type Instant = string & { readonly [instantBrand]: 'Instant' };

/** An IANA timezone used to interpret project calendar dates. */
export type ProjectTimeZone = string & {
  readonly [projectTimeZoneBrand]: 'ProjectTimeZone';
};

export type ProjectDueState = 'invalid' | 'overdue' | 'due_today' | 'upcoming';

export const DEFAULT_PROJECT_TIME_ZONE = 'America/Los_Angeles' as ProjectTimeZone;

const DAY_MS = 86_400_000;
const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

type PlainDateParts = Readonly<{
  year: number;
  month: number;
  day: number;
}>;

type ZonedDateTimeParts = PlainDateParts & Readonly<{
  hour: number;
  minute: number;
  second: number;
}>;

export function parsePlainDate(value: unknown): PlainDate | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const us = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  const rawYear = iso ? Number(iso[1]) : us ? Number(us[3]) : NaN;
  const parts = iso
    ? { year: rawYear, month: Number(iso[2]), day: Number(iso[3]) }
    : us
      ? {
          year: rawYear < 100 ? 2000 + rawYear : rawYear,
          month: Number(us[1]),
          day: Number(us[2]),
        }
      : null;
  if (!parts || !validPlainDateParts(parts)) return null;
  return formatPlainDateParts(parts);
}

export function parseInstant(value: unknown): Instant | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() as Instant : null;
}

export function parseProjectTimeZone(value: unknown): ProjectTimeZone | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timeZone = value.trim();
  try {
    zonedFormatter(timeZone).format(new Date(0));
    return timeZone as ProjectTimeZone;
  } catch {
    return null;
  }
}

export function projectTimeZoneOrDefault(value: unknown): ProjectTimeZone {
  return parseProjectTimeZone(value) ?? DEFAULT_PROJECT_TIME_ZONE;
}

export function plainDateAtInstant(
  instant: Date | Instant | string,
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
): PlainDate | null {
  const date = instantDate(instant);
  const timeZone = parseProjectTimeZone(projectTimeZone);
  if (!date || !timeZone) return null;
  const parts = zonedDateTimeParts(date, timeZone);
  return formatPlainDateParts(parts);
}

/** Explicit migration boundary for legacy schedule fields that stored an Instant. */
export function projectCalendarDate(
  value: unknown,
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
): PlainDate | null {
  const plainDate = parsePlainDate(value);
  if (plainDate) return plainDate;
  const instant = parseInstant(value);
  return instant ? plainDateAtInstant(instant, projectTimeZone) : null;
}

/**
 * Returns calendar-day distance, not elapsed 24-hour periods. This is stable
 * across daylight-saving transitions because both values are PlainDates.
 */
export function plainDateRelativeDays(
  value: unknown,
  now: Date | Instant | string = new Date(),
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
): number | null {
  const dueDate = parsePlainDate(value);
  const today = plainDateAtInstant(now, projectTimeZone);
  if (!dueDate || !today) return null;
  return plainDateOrdinal(dueDate) - plainDateOrdinal(today);
}

export function projectDateRelativeDays(
  value: unknown,
  now: Date | Instant | string = new Date(),
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
): number | null {
  const dueDate = projectCalendarDate(value, projectTimeZone);
  return dueDate ? plainDateRelativeDays(dueDate, now, projectTimeZone) : null;
}

export function plainDateDueState(
  value: unknown,
  now: Date | Instant | string = new Date(),
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
): ProjectDueState {
  const relativeDays = plainDateRelativeDays(value, now, projectTimeZone);
  if (relativeDays === null) return 'invalid';
  if (relativeDays < 0) return 'overdue';
  if (relativeDays === 0) return 'due_today';
  return 'upcoming';
}

/** The final millisecond of the calendar date in the project timezone. */
export function plainDateEndOfDayInstant(
  value: unknown,
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
): Instant | null {
  const date = parsePlainDate(value);
  const timeZone = parseProjectTimeZone(projectTimeZone);
  if (!date || !timeZone) return null;
  const nextDate = addPlainDateDays(date, 1);
  const nextMidnight = zonedLocalDateTimeToDate(
    { ...plainDateParts(nextDate), hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  return nextMidnight
    ? new Date(nextMidnight.getTime() - 1).toISOString() as Instant
    : null;
}

function instantDate(value: Date | Instant | string): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  const instant = parseInstant(value);
  return instant ? new Date(instant) : null;
}

function validPlainDateParts(parts: PlainDateParts) {
  if (!Number.isInteger(parts.year) || !Number.isInteger(parts.month) || !Number.isInteger(parts.day)) {
    return false;
  }
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day;
}

function plainDateParts(value: PlainDate): PlainDateParts {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function formatPlainDateParts(parts: PlainDateParts): PlainDate {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` as PlainDate;
}

function plainDateOrdinal(value: PlainDate) {
  const parts = plainDateParts(value);
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

function addPlainDateDays(value: PlainDate, days: number): PlainDate {
  const parts = plainDateParts(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatPlainDateParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function zonedFormatter(timeZone: string) {
  const cached = zonedFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  zonedFormatterCache.set(timeZone, formatter);
  return formatter;
}

function zonedDateTimeParts(date: Date, timeZone: ProjectTimeZone): ZonedDateTimeParts {
  const values = Object.fromEntries(
    zonedFormatter(timeZone)
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function zonedLocalDateTimeToDate(
  desired: ZonedDateTimeParts,
  timeZone: ProjectTimeZone,
): Date | null {
  const desiredEpoch = partsAsUtcEpoch(desired);
  let candidateEpoch = desiredEpoch;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observed = zonedDateTimeParts(new Date(candidateEpoch), timeZone);
    const delta = desiredEpoch - partsAsUtcEpoch(observed);
    candidateEpoch += delta;
    if (delta === 0) break;
  }
  const candidate = new Date(candidateEpoch);
  const observed = zonedDateTimeParts(candidate, timeZone);
  return sameDateTimeParts(observed, desired) ? candidate : null;
}

function partsAsUtcEpoch(parts: ZonedDateTimeParts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function sameDateTimeParts(left: ZonedDateTimeParts, right: ZonedDateTimeParts) {
  return left.year === right.year && left.month === right.month && left.day === right.day &&
    left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}
