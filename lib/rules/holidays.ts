import { addDays, type DateStr } from "../dates";
import type { LaborRules } from "./types";

/** Uskrs (gregorijanski kalendar), Meeus/Jones/Butcher algoritam. */
export function easterSunday(year: number): DateStr {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Blagdani za godinu: datum -> naziv. */
export function holidaysForYear(rules: LaborRules, year: number): Map<DateStr, string> {
  const out = new Map<DateStr, string>();
  for (const h of rules.holidays.fixed) out.set(`${year}-${h.date}`, h.name);
  const easter = easterSunday(year);
  for (const h of rules.holidays.easter_offsets) out.set(addDays(easter, h.offset), h.name);
  return out;
}

export function holidaysBetween(rules: LaborRules, from: DateStr, to: DateStr): Map<DateStr, string> {
  const out = new Map<DateStr, string>();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const [d, n] of holidaysForYear(rules, y)) if (d >= from && d <= to) out.set(d, n);
  }
  return out;
}
