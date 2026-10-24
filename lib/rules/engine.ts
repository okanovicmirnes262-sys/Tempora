// Upozorenja za raspored. Nikad ništa ne blokiraju — samo opisuju što nije u redu
// i predlažu tko bi mogao uskočiti. Sva pravila dolaze iz LaborRules (labor_rules tablica).

import {
  addDays, dayIndex, dateRange, fmtHours, fmtShort, isoWeekday, mondayOf,
  timeToMinutes, WEEKDAYS_INSTR, type DateStr,
} from "../dates";
import {
  ABSENCE_LABEL, type Absence, type Assignment, type Employee, type ScheduleData,
  type ShiftTemplate, type Unavailability, type Warning,
} from "./types";

export const FREE_CELL = "free";

export interface ShiftInstance {
  date: DateStr;
  template: ShiftTemplate;
  employee_id: string;
  /** Minute od epohe (lokalno vrijeme). */
  start: number;
  end: number;
}

interface WorkdayBlock {
  date: DateStr;
  start: number;
  end: number;
  shifts: ShiftInstance[];
}

export function shiftBounds(date: DateStr, t: Pick<ShiftTemplate, "start_time" | "end_time">) {
  const base = dayIndex(date) * 1440;
  const start = base + timeToMinutes(t.start_time);
  let end = base + timeToMinutes(t.end_time);
  if (end <= start) end += 1440; // smjena preko ponoći
  return { start, end };
}

export function templateMinutes(t: Pick<ShiftTemplate, "start_time" | "end_time">): number {
  const { start, end } = shiftBounds("2000-01-03", t);
  return end - start;
}

export function cellKey(date: DateStr, cell: string) {
  return `${date}|${cell}`;
}

/** Pomoćni indeksi nad podacima rasporeda. */
export class ScheduleIndex {
  readonly tpl = new Map<string, ShiftTemplate>();
  readonly loc = new Map<string, { id: string; name: string; closed_weekdays: number[] }>();
  readonly emp = new Map<string, Employee>();
  readonly shiftsByEmp = new Map<string, ShiftInstance[]>();
  readonly byCell = new Map<string, Assignment[]>();
  readonly byEmpDate = new Map<string, ShiftInstance[]>();
  private readonly closures = new Set<string>();

  constructor(readonly data: ScheduleData) {
    for (const t of data.templates) this.tpl.set(t.id, t);
    for (const l of data.locations) this.loc.set(l.id, l);
    for (const e of data.employees) this.emp.set(e.id, e);
    for (const c of data.closures) this.closures.add(`${c.location_id}|${c.date}`);
    for (const a of data.assignments) {
      const t = this.tpl.get(a.shift_template_id);
      if (!t) continue;
      const k = cellKey(a.date, a.shift_template_id);
      const arr = this.byCell.get(k);
      if (arr) arr.push(a);
      else this.byCell.set(k, [a]);
      const s: ShiftInstance = { date: a.date, template: t, employee_id: a.employee_id, ...shiftBounds(a.date, t) };
      push(this.shiftsByEmp, a.employee_id, s);
      push(this.byEmpDate, `${a.employee_id}|${a.date}`, s);
    }
    for (const list of this.shiftsByEmp.values()) list.sort((a, b) => a.start - b.start);
  }

  label(t: ShiftTemplate): string {
    const l = this.loc.get(t.location_id);
    return l ? `${l.name} ${t.name}` : t.name;
  }

  name(empId: string): string {
    return this.emp.get(empId)?.name ?? "Radnik";
  }

  isClosed(locationId: string, date: DateStr): boolean {
    const l = this.loc.get(locationId);
    return !!l?.closed_weekdays?.includes(isoWeekday(date)) || this.closures.has(`${locationId}|${date}`);
  }

  absence(empId: string, date: DateStr): Absence | undefined {
    return this.data.absences.find((a) => a.employee_id === empId && a.date_from <= date && a.date_to >= date);
  }

  unavailable(empId: string, date: DateStr): Unavailability | undefined {
    const wd = isoWeekday(date);
    return this.data.availability.find(
      (u) => u.employee_id === empId && (u.date === date || u.weekday === wd),
    );
  }

  shiftsOn(empId: string, date: DateStr): ShiftInstance[] {
    return this.byEmpDate.get(`${empId}|${date}`) ?? [];
  }

  blocks(empId: string, extra?: ShiftInstance): WorkdayBlock[] {
    const shifts = [...(this.shiftsByEmp.get(empId) ?? [])];
    if (extra) {
      shifts.push(extra);
      shifts.sort((a, b) => a.start - b.start);
    }
    return toBlocks(shifts);
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

/** Smjene koje počinju istog dana čine jedan radni dan (npr. jutro + popodne). */
function toBlocks(sorted: ShiftInstance[]): WorkdayBlock[] {
  const out: WorkdayBlock[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.date === s.date) {
      last.end = Math.max(last.end, s.end);
      last.shifts.push(s);
    } else {
      out.push({ date: s.date, start: s.start, end: s.end, shifts: [s] });
    }
  }
  return out;
}

/** Tjedni odmor: označava smjene koje krše pravilo, s razlogom. */
function weeklyRestViolations(blocks: WorkdayBlock[], data: ScheduleData) {
  const r = data.rules;
  const qualifying = r.weekly_rest_hours * 60;
  const maxStretch = (r.rest_period_days * 24 - r.weekly_rest_hours) * 60;
  const flagged = new Map<ShiftInstance, { run: number }>();
  let stretchStart = -Infinity;
  let run = 0;
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    const prev = blocks[k - 1];
    if (!prev || b.start - prev.end >= qualifying) stretchStart = b.start;
    run = prev && dayIndex(b.date) === dayIndex(prev.date) + 1 ? run + 1 : 1;
    for (const s of b.shifts) {
      if (run > r.max_consecutive_days || s.end - stretchStart > maxStretch) flagged.set(s, { run });
    }
  }
  return flagged;
}

/** Sva upozorenja za dane od `from` do `to` (uključivo). */
export function computeWarnings(data: ScheduleData, from: DateStr, to: DateStr): Warning[] {
  const ix = new ScheduleIndex(data);
  const r = data.rules;
  const out: Warning[] = [];
  const inRange = (d: DateStr) => d >= from && d <= to;
  const activeEmployees = data.employees.filter((e) => e.active !== false);

  for (const emp of data.employees) {
    const name = emp.name;
    const shifts = ix.shiftsByEmp.get(emp.id) ?? [];
    if (!shifts.length) continue;
    const blocks = toBlocks(shifts);

    // Dnevni odmor između radnih dana
    for (let k = 1; k < blocks.length; k++) {
      const prev = blocks[k - 1];
      const cur = blocks[k];
      if (!inRange(cur.date)) continue;
      const gap = cur.start - prev.end;
      const need = r.daily_rest_hours * 60;
      const last = prev.shifts[prev.shifts.length - 1];
      const after = `${ix.label(last.template)} (${fmtShort(prev.date)})`;
      if (gap < need) {
        out.push({
          kind: "daily_rest", severity: "red", date: cur.date, cell: cur.shifts[0].template.id, employee_id: emp.id,
          message: `${name}: samo ${fmtHours(Math.max(gap, 0))} h odmora nakon smjene ${after}. Potrebno je najmanje ${r.daily_rest_hours} h.`,
        });
      } else if (gap === need) {
        out.push({
          kind: "daily_rest", severity: "yellow", date: cur.date, cell: cur.shifts[0].template.id, employee_id: emp.id,
          message: `${name}: točno ${r.daily_rest_hours} h odmora nakon smjene ${after} — na rubu.`,
        });
      }
    }

    // Tjedni odmor
    for (const [s, { run }] of weeklyRestViolations(blocks, data)) {
      if (!inRange(s.date)) continue;
      out.push({
        kind: "weekly_rest", severity: "red", date: s.date, cell: s.template.id, employee_id: emp.id,
        message: run > r.max_consecutive_days
          ? `${name} radi ${run}. dan zaredom — nema tjednog odmora od ${r.weekly_rest_hours} h (24 + ${r.daily_rest_hours}) u ${r.rest_period_days} dana.`
          : `${name} nema ${r.weekly_rest_hours} h neprekidnog odmora u razdoblju od ${r.rest_period_days} dana.`,
      });
    }

    // Isti radnik na dva mjesta u isto vrijeme
    for (let i = 0; i < shifts.length; i++) {
      for (let j = i + 1; j < shifts.length && shifts[j].start < shifts[i].end; j++) {
        const a = shifts[i];
        const b = shifts[j];
        const message = `${name}: dvije smjene u isto vrijeme — ${ix.label(a.template)} i ${ix.label(b.template)}.`;
        for (const s of [a, b]) {
          if (inRange(s.date)) {
            out.push({ kind: "double_booking", severity: "red", date: s.date, cell: s.template.id, employee_id: emp.id, message });
          }
        }
      }
    }

    // Prekovremeni rad iznad godišnjeg maksimuma
    if (emp.weekly_hours > 0) {
      const weeks = new Map<DateStr, ShiftInstance[]>();
      for (const s of shifts) push(weeks, mondayOf(s.date), s);
      const cumByYear = new Map<number, number>();
      for (const monday of [...weeks.keys()].sort()) {
        const year = Number(addDays(monday, 3).slice(0, 4)); // godina tjedna = godina njegovog četvrtka
        const worked = weeks.get(monday)!.reduce((sum, s) => sum + (s.end - s.start), 0);
        const cum = (cumByYear.get(year) ?? 0) + Math.max(0, worked - emp.weekly_hours * 60);
        cumByYear.set(year, cum);
        if (cum > r.overtime_max_hours_per_year * 60) {
          for (const s of weeks.get(monday)!) {
            if (!inRange(s.date)) continue;
            out.push({
              kind: "overtime_year", severity: "red", date: s.date, cell: s.template.id, employee_id: emp.id,
              message: `${name}: ${fmtHours(cum)} h prekovremenog rada u ${year}. (najviše ${r.overtime_max_hours_per_year} h godišnje).`,
            });
          }
        }
      }
    }

    // Raspoređen kad ne može / kad je odsutan
    for (const s of shifts) {
      if (!inRange(s.date)) continue;
      const u = ix.unavailable(emp.id, s.date);
      if (u) {
        const when = u.weekday ? WEEKDAYS_INSTR[u.weekday - 1] : fmtShort(s.date);
        out.push({
          kind: "unavailable", severity: "red", date: s.date, cell: s.template.id, employee_id: emp.id,
          message: `${name}: ne može raditi ${when}${u.note ? ` („${u.note}”)` : ""}.`,
        });
      }
      const a = ix.absence(emp.id, s.date);
      if (a) {
        out.push({
          kind: "absent", severity: "red", date: s.date, cell: s.template.id, employee_id: emp.id,
          message: `${name}: ${ABSENCE_LABEL[a.type].toLowerCase()} taj dan.`,
        });
      }
    }
  }

  const activeTemplates = data.templates.filter((t) => t.active !== false);
  const plannedWeeks = new Set(data.assignments.map((a) => mondayOf(a.date)));

  for (const date of dateRange(from, to)) {
    for (const t of activeTemplates) {
      const assigned = ix.byCell.get(cellKey(date, t.id)) ?? [];
      // Stanka (samo informacija)
      const minutes = templateMinutes(t);
      if (assigned.length && minutes >= r.break.min_shift_hours * 60) {
        out.push({
          kind: "break", severity: "info", date, cell: t.id,
          message: `Smjena traje ${fmtHours(minutes)} h i uključuje ${r.break.minutes} min stanke.`,
        });
      }
      // Nepokrivena smjena
      if (!assigned.length && !ix.isClosed(t.location_id, date)) {
        out.push({
          kind: "uncovered", severity: "yellow", date, cell: t.id,
          message: `Nitko nije raspoređen na ${ix.label(t)}.`,
        });
      }
    }

    // Neoznačeni radnici (samo u tjednima koji se već slažu)
    if (plannedWeeks.has(mondayOf(date))) {
      for (const e of activeEmployees) {
        if (ix.shiftsOn(e.id, date).length || ix.absence(e.id, date) || ix.unavailable(e.id, date)) continue;
        out.push({
          kind: "unmarked", severity: "yellow", date, cell: FREE_CELL, employee_id: e.id,
          message: `${e.name}: bez smjene i bez oznake slobodnog dana.`,
        });
      }
    }
  }

  return out;
}

export function groupByCell(warnings: Warning[]): Map<string, Warning[]> {
  const m = new Map<string, Warning[]>();
  for (const w of warnings) push(m, cellKey(w.date, w.cell), w);
  return m;
}

/** Najgora razina među upozorenjima (za točkicu na polju). */
export function worstSeverity(ws: Warning[] | undefined): "red" | "yellow" | null {
  if (!ws?.length) return null;
  if (ws.some((w) => w.severity === "red")) return "red";
  if (ws.some((w) => w.severity === "yellow")) return "yellow";
  return null;
}

export interface Suggestion {
  employee: Employee;
  note: string;
}

/**
 * Tko može uskočiti u smjenu: nema smjenu taj dan, nije na GO/bolovanju, nije rekao da ne može,
 * i ne bi prekršio dnevni ili tjedni odmor.
 */
export function suggestReplacements(data: ScheduleData, date: DateStr, templateId: string): Suggestion[] {
  const ix = new ScheduleIndex(data);
  const t = ix.tpl.get(templateId);
  if (!t) return [];
  const r = data.rules;
  const bounds = shiftBounds(date, t);
  const monday = mondayOf(date);
  const weekEnd = addDays(monday, 6);

  const out: (Suggestion & { rank: number; minutes: number })[] = [];
  for (const e of data.employees) {
    if (e.active === false) continue;
    if (ix.shiftsOn(e.id, date).length) continue;
    const abs = ix.absence(e.id, date);
    if (abs && abs.type !== "slobodan") continue;
    if (ix.unavailable(e.id, date)) continue;

    const extra: ShiftInstance = { date, template: t, employee_id: e.id, ...bounds };
    const blocks = ix.blocks(e.id, extra);
    const k = blocks.findIndex((b) => b.date === date);
    const prev = blocks[k - 1];
    const next = blocks[k + 1];
    const need = r.daily_rest_hours * 60;
    if (prev && blocks[k].start - prev.end < need) continue;
    if (next && next.start - blocks[k].end < need) continue;
    const flagged = weeklyRestViolations(blocks, data);
    if ([...flagged.keys()].some((s) => s.date >= addDays(date, -6) && s.date <= addDays(date, 6))) continue;

    const minutes = (ix.shiftsByEmp.get(e.id) ?? [])
      .filter((s) => s.date >= monday && s.date <= weekEnd)
      .reduce((sum, s) => sum + (s.end - s.start), 0);
    out.push({
      employee: e,
      note: abs ? "slobodan dan, ali može" : `slobodno taj dan · ${fmtHours(minutes)} h ovaj tjedan`,
      rank: abs ? 1 : 0,
      minutes,
    });
  }
  out.sort((a, b) => a.rank - b.rank || a.minutes - b.minutes || a.employee.name.localeCompare(b.employee.name, "hr"));
  return out.map(({ employee, note }) => ({ employee, note }));
}
