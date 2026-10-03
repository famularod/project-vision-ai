import {
  DEFAULT_PROJECT_TIME_ZONE,
  parseMonthNameDateParts,
  projectDateRelativeDays,
  type Instant,
  type ProjectTimeZone,
} from '../services/ProjectDateTime';

export function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatSavedTime(value: string | null) {
  if (!value) return 'Recently';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Recently';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function parseDueDate(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
}

export function formatDueDate(value: string) {
  const date = parseDueDate(value);

  if (!date) return value.trim();

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function normalizeDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);

  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * A weekday written before a date: "Thu 12/31/26", "Mon 1/4/27", "Monday,
 * October 5, 2026" (whole-app audit A5 pass 17 L1, 1 Oct 2026). A CSV whose
 * dates carried one came in with every row's dates blank, and approval saved
 * them so. Only a weekday's own names, followed by a space: no other form
 * begins with one, so every other form parses as before.
 */
const LEADING_WEEKDAY = /^(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\.?,?\s+/i;

export function parseFlexibleDate(value: string) {
  const trimmed = value.trim().replace(LEADING_WEEKDAY, '');
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      date.setHours(0, 0, 0, 0);
      return date;
    }
  }

  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!usMatch) {
    // "Jul 24, 2026": how schedule imports stored dates until 30 Sep 2026 (audit A5).
    const named = parseMonthNameDateParts(trimmed);
    if (!named) return null;
    const date = new Date(named.year, named.month - 1, named.day);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  const month = Number(usMatch[1]);
  const day = Number(usMatch[2]);
  const rawYear = Number(usMatch[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
}

export function formatAppDate(value: string) {
  const date = parseFlexibleDate(value);

  if (!date) return value.trim();

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatCalendarDate(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

export function daysUntilDate(
  value: string,
  now: Date | Instant | string = new Date(),
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
) {
  return projectDateRelativeDays(value, now, projectTimeZone);
}

export function dueStatusText(
  value: string,
  now: Date | Instant | string = new Date(),
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
) {
  const days = daysUntilDate(value, now, projectTimeZone);

  if (days === null) return value.trim() ? `Due ${value}` : 'No due date';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';

  return `Due in ${days} days`;
}

export function pluralWord(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}
