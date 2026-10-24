// Datumi kao 'YYYY-MM-DD' stringovi, računanje u UTC-u da vremenske zone ne smetaju.

export type DateStr = string;

const DAY_MS = 86_400_000;

export function toDate(d: DateStr): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fromDate(d: Date): DateStr {
  return d.toISOString().slice(0, 10);
}

/** Broj dana od 1970-01-01. */
export function dayIndex(d: DateStr): number {
  return Math.round(toDate(d).getTime() / DAY_MS);
}

export function fromDayIndex(i: number): DateStr {
  return fromDate(new Date(i * DAY_MS));
}

export function addDays(d: DateStr, n: number): DateStr {
  return fromDayIndex(dayIndex(d) + n);
}

/** ISO dan u tjednu: 1 = ponedjeljak … 7 = nedjelja. */
export function isoWeekday(d: DateStr): number {
  const w = toDate(d).getUTCDay();
  return w === 0 ? 7 : w;
}

export function mondayOf(d: DateStr): DateStr {
  return addDays(d, 1 - isoWeekday(d));
}

export function monthStart(d: DateStr): DateStr {
  return d.slice(0, 8) + "01";
}

export function monthEnd(d: DateStr): DateStr {
  const dt = toDate(monthStart(d));
  return fromDate(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)));
}

export function dateRange(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let i = dayIndex(from); i <= dayIndex(to); i++) out.push(fromDayIndex(i));
  return out;
}

export function todayLocal(timeZone = "Europe/Zagreb"): DateStr {
  // en-CA daje format YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Trenutak u minutama od epohe po lokalnom (naivnom) vremenu, isto kao i smjene. */
export function nowLocalMinutes(timeZone = "Europe/Zagreb"): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return dayIndex(todayLocal(timeZone)) * 1440 + h * 60 + m;
}

/** 'HH:MM' ili 'HH:MM:SS' -> minute od ponoći. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function hhmm(t: string): string {
  return t.slice(0, 5);
}

export const WEEKDAYS_SHORT = ["pon", "uto", "sri", "čet", "pet", "sub", "ned"];
export const WEEKDAYS_LONG = ["ponedjeljak", "utorak", "srijeda", "četvrtak", "petak", "subota", "nedjelja"];
export const WEEKDAYS_INSTR = ["ponedjeljkom", "utorkom", "srijedom", "četvrtkom", "petkom", "subotom", "nedjeljom"];
export const MONTHS = [
  "siječanj", "veljača", "ožujak", "travanj", "svibanj", "lipanj",
  "srpanj", "kolovoz", "rujan", "listopad", "studeni", "prosinac",
];
export const MONTHS_GEN = [
  "siječnja", "veljače", "ožujka", "travnja", "svibnja", "lipnja",
  "srpnja", "kolovoza", "rujna", "listopada", "studenoga", "prosinca",
];

/** 'čet 22.10.' */
export function fmtShort(d: DateStr): string {
  const dt = toDate(d);
  return `${WEEKDAYS_SHORT[isoWeekday(d) - 1]} ${dt.getUTCDate()}.${dt.getUTCMonth() + 1}.`;
}

/** '22.10.' */
export function fmtDM(d: DateStr): string {
  const dt = toDate(d);
  return `${dt.getUTCDate()}.${dt.getUTCMonth() + 1}.`;
}

/** '22. listopada' */
export function fmtDayMonth(d: DateStr): string {
  const dt = toDate(d);
  return `${dt.getUTCDate()}. ${MONTHS_GEN[dt.getUTCMonth()]}`;
}

export function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h}` : h.toFixed(1).replace(".", ",");
}
