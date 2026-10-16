/**
 * N761g (open item 7.61, 16 Oct 2026): the phone's JavaScript engine, as far as reading a date from text goes.
 *
 * Jest runs every test on the computer's engine (V8, as Chrome; Safari's reads these the same), which reads
 * "01/22/2027" as a day. The phone and the iPad run the app on Hermes, which reads a date from text only in the ISO form
 * the ECMAScript standard requires of every engine ("2027-01-22", "2026-10-15T20:52:57.448Z") and in the forms its own
 * toString / toUTCString write; anything else is "Invalid Date" (NaN). Build 235's report check details showed it on
 * the owner's devices (Test project, Project Manager, 16 Oct): the same records on both, ten tasks with finish dates
 * such as "01/22/2027", and the report's Project Position read "forecast finish: none" on the phone (null) and
 * "01/22/2027" on the computer: the only difference, and why the computer never knew the phone's report.
 *
 * `onThePhonesEngine` runs a piece of the phone's path with `Date` reading text as the phone does (built over whatever
 * `Date` is current, so Jest's fake clock still holds), and puts the engine back afterwards. Numbers, parts and other
 * dates are read as before; only text is read the phone's way.
 */
const ISO_FORM = /^(?:[+-]\d{6}|\d{4})(?:-\d{2}(?:-\d{2})?)?(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const DAY = '(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)';
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const TO_STRING_FORM = new RegExp(`^${DAY} ${MONTH} \\d{2} -?\\d{4}(?: \\d{2}:\\d{2}:\\d{2} GMT[+-]\\d{4}(?: \\(.+\\))?)?$`);
const TO_UTC_STRING_FORM = new RegExp(`^${DAY}, \\d{2} ${MONTH} -?\\d{4} \\d{2}:\\d{2}:\\d{2} GMT$`);

/** Whether the phone's engine reads `text` as a date at all. */
export function thePhonesEngineReads(text: string): boolean {
  return ISO_FORM.test(text) || TO_STRING_FORM.test(text) || TO_UTC_STRING_FORM.test(text);
}

function phoneDate(Engine: DateConstructor): DateConstructor {
  const readable = (value: unknown) => typeof value !== 'string' || thePhonesEngineReads(value);
  class PhoneDate extends Engine {
    constructor(...args: unknown[]) {
      if (args.length === 1 && !readable(args[0])) super(Number.NaN);
      else super(...(args as []));
    }
    static parse(text: string): number {
      return thePhonesEngineReads(String(text)) ? Engine.parse(String(text)) : Number.NaN;
    }
    static [Symbol.hasInstance](value: unknown): boolean {
      return value instanceof Engine;
    }
  }
  // `Date()` called without new gives the time as text, as every engine does.
  return new Proxy(PhoneDate, { apply: () => new Engine().toString() }) as unknown as DateConstructor;
}

/** Runs `run` with `Date` reading text as the phone's engine does; the engine is put back afterwards. */
export function onThePhonesEngine<T>(run: () => T): T {
  const root = globalThis as { Date: DateConstructor };
  const engine = root.Date;
  root.Date = phoneDate(engine);
  try {
    const result = run();
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      return (result as unknown as Promise<unknown>).finally(() => { root.Date = engine; }) as unknown as T;
    }
    root.Date = engine;
    return result;
  } catch (error) {
    root.Date = engine;
    throw error;
  }
}
