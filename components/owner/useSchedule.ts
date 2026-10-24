"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, dateRange, isoWeekday, todayLocal, type DateStr } from "@/lib/dates";
import { computeWarnings, groupByCell } from "@/lib/rules/engine";
import type { AbsenceType, ScheduleData } from "@/lib/rules/types";
import {
  db, loadSetup, must,
  type AbsenceRow, type AssignmentRow, type AvailabilityRow, type ClosureRow, type Setup,
} from "@/lib/owner/data";

export const key3 = (a: { date: string; shift_template_id: string; employee_id: string }) =>
  `${a.date}|${a.shift_template_id}|${a.employee_id}`;

/** Sve stanje i radnje ekrana rasporeda. */
export function useSchedule(orgId: string, country: string, from: DateStr, to: DateStr, onError: (e: unknown) => void) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [published, setPublished] = useState<AssignmentRow[]>([]);
  const [absences, setAbsences] = useState<AbsenceRow[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedRange, setLoadedRange] = useState("");

  // Za prekovremene trebamo cijelu godinu; za odmore 14 dana prije i 7 poslije.
  const loadFrom = useMemo(() => {
    const yearStart = `${from.slice(0, 4)}-01-01`;
    const pad = addDays(from, -14);
    return pad < yearStart ? pad : yearStart;
  }, [from]);
  const loadTo = useMemo(() => addDays(to, 7), [to]);

  const reload = useCallback(async () => {
    const c = db();
    const [s, a, p, ab, av, cl] = await Promise.all([
      loadSetup(orgId, country),
      c.from("assignments").select("id, date, shift_template_id, employee_id").eq("org_id", orgId)
        .gte("date", loadFrom).lte("date", loadTo).limit(20000),
      c.from("published_assignments").select("date, shift_template_id, employee_id").eq("org_id", orgId)
        .gte("date", from).lte("date", to).limit(5000),
      c.from("absences").select("id, employee_id, date_from, date_to, type").eq("org_id", orgId)
        .lte("date_from", loadTo).gte("date_to", addDays(from, -14)),
      c.from("availability").select("id, employee_id, date, weekday, note").eq("org_id", orgId),
      c.from("location_closures").select("location_id, date").eq("org_id", orgId).gte("date", from).lte("date", to),
    ]);
    setSetup(s);
    setAssignments(must(a) as AssignmentRow[]);
    setPublished(must(p) as AssignmentRow[]);
    setAbsences(must(ab) as AbsenceRow[]);
    setAvailability(must(av) as AvailabilityRow[]);
    setClosures(must(cl) as ClosureRow[]);
    setLoadedRange(`${from}|${to}`);
    setLoading(false);
  }, [orgId, country, from, to, loadFrom, loadTo]);

  useEffect(() => {
    setLoading(true);
    reload().catch(() => setLoading(false));
  }, [reload]);

  const data: ScheduleData | null = useMemo(() => {
    if (!setup) return null;
    return {
      rules: setup.rules,
      employees: setup.employees.map((e) => ({ id: e.id, name: e.name, weekly_hours: e.weekly_hours, active: e.active })),
      locations: setup.locations,
      templates: setup.templates,
      assignments,
      absences,
      availability,
      closures,
    };
  }, [setup, assignments, absences, availability, closures]);

  const warnings = useMemo(() => (data ? computeWarnings(data, from, to) : []), [data, from, to]);
  const byCell = useMemo(() => groupByCell(warnings), [warnings]);

  // Neobjavljene promjene u prikazanom rasponu
  const { changedCells, unpublished } = useMemo(() => {
    const inRange = (a: AssignmentRow) => a.date >= from && a.date <= to;
    const d = new Set(assignments.filter(inRange).map(key3));
    const p = new Set(published.map(key3));
    const cells = new Set<string>();
    let n = 0;
    for (const k of d) if (!p.has(k)) { n++; cells.add(k.split("|").slice(0, 2).join("|")); }
    for (const k of p) if (!d.has(k)) { n++; cells.add(k.split("|").slice(0, 2).join("|")); }
    return { changedCells: cells, unpublished: n };
  }, [assignments, published, from, to]);

  // ---------------- Radnje ----------------
  const fail = useRef(onError);
  useEffect(() => { fail.current = onError; }, [onError]);

  const toggleAssignment = useCallback(async (date: DateStr, tplId: string, empId: string) => {
    const k = `${date}|${tplId}|${empId}`;
    const exists = assignments.some((a) => key3(a) === k);
    const freeDay = absences.find((a) => a.employee_id === empId && a.type === "slobodan" && a.date_from === date && a.date_to === date);
    if (exists) {
      setAssignments((prev) => prev.filter((a) => key3(a) !== k));
      const r = await db().from("assignments").delete().match({ date, shift_template_id: tplId, employee_id: empId });
      if (r.error) { fail.current(r.error); reload(); }
    } else {
      setAssignments((prev) => [...prev, { date, shift_template_id: tplId, employee_id: empId }]);
      // Raspoređen radnik više nije "slobodan" taj dan
      if (freeDay) setAbsences((prev) => prev.filter((a) => a.id !== freeDay.id));
      const r = await db().from("assignments").insert({ org_id: orgId, date, shift_template_id: tplId, employee_id: empId });
      if (freeDay) await db().from("absences").delete().eq("id", freeDay.id);
      if (r.error) { fail.current(r.error); reload(); }
    }
  }, [assignments, absences, orgId, reload]);

  const toggleFree = useCallback(async (date: DateStr, empId: string) => {
    const existing = absences.find((a) => a.employee_id === empId && a.date_from <= date && a.date_to >= date);
    if (existing) {
      if (existing.type !== "slobodan" || existing.date_from !== existing.date_to) return;
      setAbsences((prev) => prev.filter((a) => a.id !== existing.id));
      const r = await db().from("absences").delete().eq("id", existing.id);
      if (r.error) { fail.current(r.error); reload(); }
    } else {
      const r = await db().from("absences")
        .insert({ org_id: orgId, employee_id: empId, date_from: date, date_to: date, type: "slobodan" })
        .select("id, employee_id, date_from, date_to, type").single();
      if (r.error) return fail.current(r.error);
      setAbsences((prev) => [...prev, r.data as AbsenceRow]);
    }
  }, [absences, orgId, reload]);

  const addAbsence = useCallback(async (empId: string, type: AbsenceType, dFrom: DateStr, dTo: DateStr) => {
    const r = await db().from("absences")
      .insert({ org_id: orgId, employee_id: empId, date_from: dFrom, date_to: dTo, type })
      .select("id, employee_id, date_from, date_to, type").single();
    if (r.error) return fail.current(r.error);
    // Jednodnevni "slobodan" unutar novog raspona je suvišan
    const redundant = absences.filter((a) => a.employee_id === empId && a.type === "slobodan" && a.date_from === a.date_to && a.date_from >= dFrom && a.date_from <= dTo);
    if (redundant.length) await db().from("absences").delete().in("id", redundant.map((a) => a.id));
    setAbsences((prev) => [...prev.filter((a) => !redundant.includes(a)), r.data as AbsenceRow]);
  }, [absences, orgId]);

  const removeAbsence = useCallback(async (id: string) => {
    setAbsences((prev) => prev.filter((a) => a.id !== id));
    const r = await db().from("absences").delete().eq("id", id);
    if (r.error) { fail.current(r.error); reload(); }
  }, [reload]);

  const toggleClosure = useCallback(async (locationId: string, date: DateStr) => {
    const exists = closures.some((c) => c.location_id === locationId && c.date === date);
    if (exists) {
      setClosures((prev) => prev.filter((c) => !(c.location_id === locationId && c.date === date)));
      const r = await db().from("location_closures").delete().match({ location_id: locationId, date });
      if (r.error) { fail.current(r.error); reload(); }
    } else {
      setClosures((prev) => [...prev, { location_id: locationId, date }]);
      const r = await db().from("location_closures").insert({ org_id: orgId, location_id: locationId, date });
      if (r.error) { fail.current(r.error); reload(); }
    }
  }, [closures, orgId, reload]);

  const blocked = useCallback((empId: string, date: DateStr) => {
    if (absences.some((a) => a.employee_id === empId && a.date_from <= date && a.date_to >= date)) return true;
    const wd = isoWeekday(date);
    return availability.some((u) => u.employee_id === empId && (u.date === date || u.weekday === wd));
  }, [absences, availability]);

  const insertAssignments = useCallback(async (rows: AssignmentRow[]) => {
    if (!rows.length) return [] as string[];
    const r = await db().from("assignments")
      .upsert(rows.map((x) => ({ org_id: orgId, ...x })), { onConflict: "date,shift_template_id,employee_id", ignoreDuplicates: true })
      .select("id");
    if (r.error) throw r.error;
    return (r.data ?? []).map((x: { id: string }) => x.id);
  }, [orgId]);

  /** Kopira prošli tjedan na prikazani (preskače odsutne i one koji ne mogu). */
  const copyPreviousWeek = useCallback(async () => {
    if (!setup) return 0;
    const existing = new Set(assignments.map(key3));
    const rows = assignments
      .filter((a) => a.date >= addDays(from, -7) && a.date <= addDays(from, -1))
      .map((a) => ({ date: addDays(a.date, 7), shift_template_id: a.shift_template_id, employee_id: a.employee_id }))
      .filter((a) => !existing.has(key3(a)) && !blocked(a.employee_id, a.date));
    const ids = await insertAssignments(rows);
    await reload();
    return ids.length;
  }, [setup, assignments, from, blocked, insertAssignments, reload]);

  /** Primjenjuje stalne tjedne uzorke na prikazani raspon. Vraća što je dodano (za poništavanje). */
  const applyPatterns = useCallback(async () => {
    if (!setup) return { assignmentIds: [] as string[], absenceIds: [] as string[] };
    const activeEmp = new Set(setup.employees.filter((e) => e.active).map((e) => e.id));
    const tpl = new Map(setup.templates.filter((t) => t.active).map((t) => [t.id, t]));
    const loc = new Map(setup.locations.map((l) => [l.id, l]));
    const closed = new Set(closures.map((c) => `${c.location_id}|${c.date}`));
    const existing = new Set(assignments.map(key3));
    const rows: AssignmentRow[] = [];
    const offs: { employee_id: string; date: string }[] = [];
    for (const date of dateRange(from, to)) {
      const wd = isoWeekday(date);
      for (const p of setup.patterns) {
        if (p.weekday !== wd || !activeEmp.has(p.employee_id)) continue;
        if (p.is_off) {
          const hasAbs = absences.some((a) => a.employee_id === p.employee_id && a.date_from <= date && a.date_to >= date);
          const works = assignments.some((a) => a.employee_id === p.employee_id && a.date === date)
            || rows.some((a) => a.employee_id === p.employee_id && a.date === date);
          if (!hasAbs && !works) offs.push({ employee_id: p.employee_id, date });
          continue;
        }
        const t = p.shift_template_id ? tpl.get(p.shift_template_id) : undefined;
        if (!t) continue;
        const l = loc.get(t.location_id);
        if (l?.closed_weekdays.includes(wd) || closed.has(`${t.location_id}|${date}`)) continue;
        const row = { date, shift_template_id: t.id, employee_id: p.employee_id };
        if (existing.has(key3(row)) || blocked(p.employee_id, date)) continue;
        rows.push(row);
      }
    }
    const assignmentIds = await insertAssignments(rows);
    let absenceIds: string[] = [];
    if (offs.length) {
      const r = await db().from("absences")
        .insert(offs.map((o) => ({ org_id: orgId, employee_id: o.employee_id, date_from: o.date, date_to: o.date, type: "slobodan" })))
        .select("id");
      if (r.error) throw r.error;
      absenceIds = (r.data ?? []).map((x: { id: string }) => x.id);
    }
    await reload();
    return { assignmentIds, absenceIds };
  }, [setup, closures, assignments, absences, from, to, blocked, insertAssignments, orgId, reload]);

  const undo = useCallback(async (u: { assignmentIds: string[]; absenceIds: string[] }) => {
    if (u.assignmentIds.length) await db().from("assignments").delete().in("id", u.assignmentIds);
    if (u.absenceIds.length) await db().from("absences").delete().in("id", u.absenceIds);
    await reload();
  }, [reload]);

  const publish = useCallback(async () => {
    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, from, to }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Objava nije uspjela");
    await reload();
    return body as { changed: number; notified: number };
  }, [orgId, from, to, reload]);

  const isPastWeek = to < todayLocal();
  const weekHasAssignments = assignments.some((a) => a.date >= from && a.date <= to);

  return {
    loading: loading || loadedRange !== `${from}|${to}`,
    setup, data, assignments, absences, availability, closures,
    warnings, byCell, changedCells, unpublished,
    isPastWeek, weekHasAssignments,
    toggleAssignment, toggleFree, addAbsence, removeAbsence, toggleClosure,
    copyPreviousWeek, applyPatterns, undo, publish, reload,
  };
}

export type ScheduleApi = ReturnType<typeof useSchedule>;
