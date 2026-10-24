"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { todayLocal } from "@/lib/dates";
import hr from "@/lib/rules/hr.json";
import type { AbsenceType, LaborRules } from "@/lib/rules/types";

export interface LocationRow { id: string; org_id: string; name: string; closed_weekdays: number[]; sort_order: number }
export interface TemplateRow {
  id: string; org_id: string; location_id: string; name: string;
  start_time: string; end_time: string; sort_order: number; active: boolean;
}
export interface EmployeeRow {
  id: string; org_id: string; name: string; phone: string | null; token: string;
  employment_type: "puno" | "skraceno"; weekly_hours: number; active: boolean; sort_order: number;
  first_opened_at: string | null;
}
export interface PatternRow { id: string; employee_id: string; weekday: number; shift_template_id: string | null; is_off: boolean }
export interface AbsenceRow { id: string; employee_id: string; date_from: string; date_to: string; type: AbsenceType }
export interface AvailabilityRow { id: string; employee_id: string; date: string | null; weekday: number | null; note: string | null }
export interface AssignmentRow { id?: string; date: string; shift_template_id: string; employee_id: string }
export interface ClosureRow { location_id: string; date: string }

export interface Setup {
  locations: LocationRow[];
  templates: TemplateRow[];
  employees: EmployeeRow[];
  patterns: PatternRow[];
  rules: LaborRules;
}

export const db = () => supabaseBrowser();

/** Baca grešku ako Supabase vrati grešku, inače vraća podatke. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function loadRules(country: string): Promise<LaborRules> {
  const { data } = await db()
    .from("labor_rules")
    .select("rules")
    .eq("country", country)
    .lte("valid_from", todayLocal())
    .order("valid_from", { ascending: false })
    .limit(1);
  return (data?.[0]?.rules as LaborRules) ?? (hr as LaborRules);
}

export async function loadSetup(orgId: string, country: string): Promise<Setup> {
  const c = db();
  const [locations, templates, employees, patterns, rules] = await Promise.all([
    c.from("locations").select("*").eq("org_id", orgId).order("sort_order").order("created_at"),
    c.from("shift_templates").select("*").eq("org_id", orgId).order("sort_order").order("start_time"),
    c.from("employees").select("*").eq("org_id", orgId).order("sort_order").order("created_at"),
    c.from("weekly_patterns").select("id, employee_id, weekday, shift_template_id, is_off").eq("org_id", orgId),
    loadRules(country),
  ]);
  const locs = must(locations) as LocationRow[];
  const order = new Map(locs.map((l, i) => [l.id, i]));
  const tpls = (must(templates) as TemplateRow[]).sort(
    (a, b) => (order.get(a.location_id) ?? 0) - (order.get(b.location_id) ?? 0) || a.start_time.localeCompare(b.start_time),
  );
  return {
    locations: locs,
    templates: tpls,
    employees: (must(employees) as EmployeeRow[]).map((e) => ({ ...e, weekly_hours: Number(e.weekly_hours) })),
    patterns: must(patterns) as PatternRow[],
    rules,
  };
}

export function workerLink(token: string) {
  return `${location.origin}/r/${token}`;
}

/** WhatsApp link s porukom; broj u međunarodnom formatu bez '+' (npr. 38591…). */
export function whatsappLink(phone: string | null, text: string) {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = "385" + digits.slice(1);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function inviteText(name: string, token: string) {
  return `Bok ${name}! Ovo je tvoj osobni link za raspored smjena: ${workerLink(token)}\nOtvori ga i dodaj na početni zaslon.`;
}
