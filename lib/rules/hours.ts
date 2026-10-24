// Obračun sati za knjigovođu. Stanka se ubraja u radno vrijeme (ZOR čl. 73).
// Noćni, nedjeljni i blagdanski sati su dodaci i mogu se preklapati.

import { fromDayIndex, isoWeekday, mondayOf, timeToMinutes, type DateStr } from "../dates";
import { shiftBounds } from "./engine";
import { holidaysBetween } from "./holidays";
import type { Assignment, Employee, LaborRules, ShiftTemplate } from "./types";

export interface HoursBreakdown {
  total: number;   // minute
  regular: number;
  night: number;
  sunday: number;
  holiday: number;
  overtime: number;
  shifts: number;
}

const empty = (): HoursBreakdown => ({ total: 0, regular: 0, night: 0, sunday: 0, holiday: 0, overtime: 0, shifts: 0 });

function isNight(minuteOfDay: number, nightStart: number, nightEnd: number) {
  return nightStart > nightEnd
    ? minuteOfDay >= nightStart || minuteOfDay < nightEnd
    : minuteOfDay >= nightStart && minuteOfDay < nightEnd;
}

/** Raspodjela minuta jedne smjene (minutu po minutu, točno i preko ponoći). */
export function splitShift(
  date: DateStr,
  t: Pick<ShiftTemplate, "start_time" | "end_time">,
  rules: LaborRules,
  holidays: Map<DateStr, string>,
) {
  const { start, end } = shiftBounds(date, t);
  const ns = timeToMinutes(rules.night.start);
  const ne = timeToMinutes(rules.night.end);
  let night = 0, sunday = 0, holiday = 0;
  for (let m = start; m < end; m++) {
    const day = fromDayIndex(Math.floor(m / 1440));
    if (isNight(m % 1440, ns, ne)) night++;
    if (isoWeekday(day) === 7) sunday++;
    if (holidays.has(day)) holiday++;
  }
  return { start, end, total: end - start, night, sunday, holiday };
}

/**
 * Sati po radniku za mjesec [from, to]. `assignments` treba pokriti i cijele tjedne na rubovima
 * mjeseca (od ponedjeljka prije `from` do nedjelje poslije `to`) zbog prekovremenih.
 */
export function monthlyHours(
  from: DateStr,
  to: DateStr,
  employees: Employee[],
  templates: ShiftTemplate[],
  assignments: Assignment[],
  rules: LaborRules,
): Map<string, HoursBreakdown> {
  const tpl = new Map(templates.map((t) => [t.id, t]));
  const holidays = holidaysBetween(rules, mondayOf(from), `${Number(to.slice(0, 4)) + 1}-01-07`);
  const out = new Map<string, HoursBreakdown>();

  for (const e of employees) {
    const res = empty();
    const shifts = assignments
      .filter((a) => a.employee_id === e.id && tpl.has(a.shift_template_id))
      .map((a) => ({ a, ...splitShift(a.date, tpl.get(a.shift_template_id)!, rules, holidays) }))
      .sort((x, y) => x.start - y.start);

    // Prekovremeni: unutar svakog tjedna (pon–ned) sati iznad ugovorenih; to su zadnji odrađeni sati tjedna.
    const weekUsed = new Map<DateStr, number>();
    const limit = e.weekly_hours * 60;
    for (const s of shifts) {
      const week = mondayOf(s.a.date);
      const used = weekUsed.get(week) ?? 0;
      weekUsed.set(week, used + s.total);
      if (s.a.date < from || s.a.date > to) continue;
      const over = limit > 0 ? Math.max(0, used + s.total - Math.max(limit, used)) : 0;
      res.total += s.total;
      res.night += s.night;
      res.sunday += s.sunday;
      res.holiday += s.holiday;
      res.overtime += over;
      res.shifts += 1;
    }
    res.regular = res.total - res.overtime;
    out.set(e.id, res);
  }
  return out;
}

/** Odrađene minute do trenutka `nowMinutes` (za "Ovaj mjesec" kod radnika). */
export function workedMinutes(
  shifts: { date: DateStr; start: string; end: string }[],
  from: DateStr,
  to: DateStr,
  nowMinutes: number,
): number {
  let sum = 0;
  for (const s of shifts) {
    if (s.date < from || s.date > to) continue;
    const b = shiftBounds(s.date, { start_time: s.start, end_time: s.end });
    if (b.start >= nowMinutes) continue;
    sum += Math.min(b.end, nowMinutes) - b.start;
  }
  return sum;
}

