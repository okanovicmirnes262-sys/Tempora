import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { addDays, dateRange, hhmm, isoWeekday, mondayOf, monthEnd, MONTHS, WEEKDAYS_LONG, toDate } from "@/lib/dates";
import { holidaysBetween } from "@/lib/rules/holidays";
import { monthlyHours, splitShift } from "@/lib/rules/hours";
import hr from "@/lib/rules/hr.json";
import type { Assignment, Employee, LaborRules, ShiftTemplate } from "@/lib/rules/types";
import { APP } from "@/lib/config";

const h = (min: number) => Math.round((min / 60) * 100) / 100;

// Excel (.xlsx) za odabrani mjesec, iz objavljenog rasporeda.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org") ?? "";
  const month = url.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Neispravan mjesec" }, { status: 400 });

  const supabase = await supabaseServer();
  const { data: org } = await supabase.from("organizations").select("id, name, country").eq("id", orgId).single();
  if (!org) return NextResponse.json({ error: "Zabranjeno" }, { status: 403 });

  const from = `${month}-01`;
  const to = monthEnd(from);
  const loadFrom = mondayOf(from);
  const loadTo = addDays(mondayOf(to), 6);

  const [emps, tpls, locs, asg, abs, rulesRow] = await Promise.all([
    supabase.from("employees").select("id, name, weekly_hours, active, employment_type, sort_order").eq("org_id", orgId).order("sort_order"),
    supabase.from("shift_templates").select("id, location_id, name, start_time, end_time").eq("org_id", orgId),
    supabase.from("locations").select("id, name").eq("org_id", orgId),
    supabase.from("published_assignments").select("date, shift_template_id, employee_id").eq("org_id", orgId)
      .gte("date", loadFrom).lte("date", loadTo).limit(20000),
    supabase.from("absences").select("employee_id, date_from, date_to, type").eq("org_id", orgId).lte("date_from", to).gte("date_to", from),
    supabase.from("labor_rules").select("rules").eq("country", org.country).lte("valid_from", to).order("valid_from", { ascending: false }).limit(1),
  ]);
  const rules = (rulesRow.data?.[0]?.rules as LaborRules) ?? (hr as LaborRules);
  const templates = (tpls.data ?? []) as ShiftTemplate[];
  const assignments = (asg.data ?? []) as Assignment[];
  const workedIds = new Set(assignments.filter((a) => a.date >= from && a.date <= to).map((a) => a.employee_id));
  const employees = ((emps.data ?? []) as (Employee & { employment_type: string })[])
    .map((e) => ({ ...e, weekly_hours: Number(e.weekly_hours) }))
    .filter((e) => e.active !== false || workedIds.has(e.id));
  const locName = new Map((locs.data ?? []).map((l) => [l.id, l.name]));
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const holidays = holidaysBetween(rules, from, to);
  const hours = monthlyHours(from, to, employees, templates, assignments, rules);

  const days = dateRange(from, to);
  const absDays = (empId: string, type: string) =>
    days.filter((d) => (abs.data ?? []).some((a) => a.employee_id === empId && a.type === type && a.date_from <= d && a.date_to >= d)).length;

  const monthLabel = `${MONTHS[toDate(from).getUTCMonth()]} ${from.slice(0, 4)}.`;
  const wb = new ExcelJS.Workbook();
  wb.creator = APP.name;
  wb.created = new Date();

  // ---------- List 1: sažetak po radniku ----------
  const ws = wb.addWorksheet("Sati po radniku", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.addRow([`Evidencija radnog vremena — ${monthLabel} — ${org.name}`]).font = { bold: true, size: 14 };
  ws.addRow([`Razdoblje: ${from} – ${to}. Izvor: objavljeni raspored.`]).font = { italic: true, color: { argb: "FF666666" } };
  const header = ws.addRow([
    "Radnik", "Ugovor (h/tj.)", "Smjena", "Ukupno sati", "Redovni", "Noćni (22–06)",
    "Nedjeljni", "Blagdanski", "Prekovremeni", "Dani GO", "Dani bolovanja",
  ]);
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
    c.border = { bottom: { style: "thin" } };
    c.alignment = { wrapText: true, vertical: "middle" };
  });
  const first = ws.rowCount + 1;
  for (const e of employees) {
    const x = hours.get(e.id)!;
    ws.addRow([
      e.name, e.weekly_hours, x.shifts, h(x.total), h(x.regular), h(x.night),
      h(x.sunday), h(x.holiday), h(x.overtime), absDays(e.id, "godisnji"), absDays(e.id, "bolovanje"),
    ]);
  }
  const last = ws.rowCount;
  const total = ws.addRow(["Ukupno", null, ...["C", "D", "E", "F", "G", "H", "I", "J", "K"].map((col) => ({ formula: `SUM(${col}${first}:${col}${last})` }))]);
  total.font = { bold: true };
  total.eachCell((c) => { c.border = { top: { style: "thin" } }; });
  for (let r = first; r <= ws.rowCount; r++) {
    for (const col of [4, 5, 6, 7, 8, 9]) ws.getRow(r).getCell(col).numFmt = "0.00";
  }
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 18 : 13; });

  ws.addRow([]);
  for (const line of [
    "Napomene:",
    `• Stanka od ${rules.break.minutes} min (smjene od ${rules.break.min_shift_hours} h i dulje) uračunata je u radno vrijeme.`,
    "• Noćni, nedjeljni i blagdanski sati su dodaci i mogu se preklapati (npr. nedjelja koja je blagdan).",
    "• Prekovremeni = sati iznad ugovorenih tjednih sati, po tjednu ponedjeljak–nedjelja; tjedan na prijelazu mjeseca računa se cijeli.",
    "• Redovni = ukupno − prekovremeni.",
    holidays.size
      ? `• Blagdani u mjesecu: ${[...holidays].map(([d, n]) => `${toDate(d).getUTCDate()}.${toDate(d).getUTCMonth() + 1}. ${n}`).join("; ")}`
      : "• U ovom mjesecu nema blagdana.",
    `• ${rules.disclaimer}`,
  ]) {
    ws.addRow([line]).font = { size: 10, color: { argb: "FF555555" }, bold: line === "Napomene:" };
  }

  // ---------- List 2: sve smjene ----------
  const ws2 = wb.addWorksheet("Smjene", { views: [{ state: "frozen", ySplit: 1 }] });
  const h2 = ws2.addRow(["Datum", "Dan", "Radnik", "Lokal", "Smjena", "Od", "Do", "Sati", "Noćni", "Nedjeljni", "Blagdanski", "Blagdan"]);
  h2.font = { bold: true };
  h2.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } }; });
  const rows = assignments
    .filter((a) => a.date >= from && a.date <= to && tplById.has(a.shift_template_id) && empName.has(a.employee_id))
    .map((a) => ({ a, t: tplById.get(a.shift_template_id)! }))
    .sort((x, y) => x.a.date.localeCompare(y.a.date) || x.t.start_time.localeCompare(y.t.start_time)
      || (empName.get(x.a.employee_id) ?? "").localeCompare(empName.get(y.a.employee_id) ?? "", "hr"));
  for (const { a, t } of rows) {
    const s = splitShift(a.date, t, rules, holidays);
    const row = ws2.addRow([
      toDate(a.date), WEEKDAYS_LONG[isoWeekday(a.date) - 1], empName.get(a.employee_id), locName.get(t.location_id), t.name,
      hhmm(t.start_time), hhmm(t.end_time), h(s.total), h(s.night), h(s.sunday), h(s.holiday), holidays.get(a.date) ?? "",
    ]);
    row.getCell(1).numFmt = "dd.mm.yyyy.";
    for (const col of [8, 9, 10, 11]) row.getCell(col).numFmt = "0.00";
  }
  ws2.columns.forEach((c, i) => { c.width = [12, 12, 16, 14, 12, 8, 8, 8, 8, 10, 11, 28][i]; });

  const buf = await wb.xlsx.writeBuffer();
  const filename = `${APP.name}-sati-${month}.xlsx`;
  return new Response(buf as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
