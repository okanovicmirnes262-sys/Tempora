"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { addDays, fmtShort, hhmm, todayLocal } from "@/lib/dates";
import { computeWarnings } from "@/lib/rules/engine";
import { db, loadSetup, must, type AbsenceRow, type AssignmentRow, type AvailabilityRow, type Setup } from "@/lib/owner/data";
import { Avatar, Dot, errMsg, useToast } from "@/components/ui";
import { useOrg } from "./OwnerShell";

interface SwapRow {
  id: string; date: string; shift_template_id: string; from_employee_id: string;
  to_employee_id: string | null; accepted_by: string | null;
  status: "ponudeno" | "prihvaceno" | "odobreno" | "odbijeno"; created_at: string; decided_at: string | null;
}

export function Swaps() {
  const org = useOrg();
  const toast = useToast();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [swaps, setSwaps] = useState<SwapRow[]>([]);
  const [ctx, setCtx] = useState<{ a: AssignmentRow[]; ab: AbsenceRow[]; av: AvailabilityRow[] }>({ a: [], ab: [], av: [] });
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const today = todayLocal();
    const [s, sw, a, ab, av] = await Promise.all([
      loadSetup(org.id, org.country),
      db().from("swap_requests").select("*").eq("org_id", org.id).gte("date", addDays(today, -30)).order("date"),
      db().from("published_assignments").select("date, shift_template_id, employee_id").eq("org_id", org.id)
        .gte("date", addDays(today, -21)).lte("date", addDays(today, 70)),
      db().from("absences").select("id, employee_id, date_from, date_to, type").eq("org_id", org.id).gte("date_to", addDays(today, -21)),
      db().from("availability").select("id, employee_id, date, weekday, note").eq("org_id", org.id),
    ]);
    setSetup(s);
    setSwaps(must(sw) as SwapRow[]);
    setCtx({ a: must(a) as AssignmentRow[], ab: must(ab) as AbsenceRow[], av: must(av) as AvailabilityRow[] });
  }, [org.id, org.country]);

  useEffect(() => { reload().catch((e) => toast(errMsg(e), "err")); }, [reload, toast]);

  const name = (id: string | null) => setup?.employees.find((e) => e.id === id)?.name ?? "—";
  const shift = (id: string) => {
    const t = setup?.templates.find((x) => x.id === id);
    const l = t && setup?.locations.find((x) => x.id === t.location_id);
    return t ? { label: `${l?.name} · ${t.name}`, time: `${hhmm(t.start_time)}–${hhmm(t.end_time)}` } : { label: "", time: "" };
  };

  /** Upozorenja koja bi nastala da kolega preuzme smjenu. */
  const preview = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!setup) return m;
    for (const s of swaps) {
      if (s.status !== "prihvaceno" || !s.accepted_by) continue;
      const assignments = ctx.a
        .filter((a) => !(a.date === s.date && a.shift_template_id === s.shift_template_id && a.employee_id === s.from_employee_id))
        .concat({ date: s.date, shift_template_id: s.shift_template_id, employee_id: s.accepted_by });
      const ws = computeWarnings({
        rules: setup.rules, employees: setup.employees, locations: setup.locations, templates: setup.templates,
        assignments, absences: ctx.ab, availability: ctx.av, closures: [],
      }, addDays(s.date, -1), addDays(s.date, 1))
        .filter((w) => w.employee_id === s.accepted_by && w.severity === "red" && w.kind !== "unmarked");
      m.set(s.id, [...new Set(ws.map((w) => w.message))]);
    }
    return m;
  }, [setup, swaps, ctx]);

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    try {
      const res = await fetch("/api/swaps/decide", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, approve }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      toast(approve ? "Odobreno · raspored je ažuriran" : "Odbijeno");
      await reload();
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(null);
    }
  }

  const today = todayLocal();
  const waiting = swaps.filter((s) => s.status === "prihvaceno" && s.date >= today);
  const offered = swaps.filter((s) => s.status === "ponudeno" && s.date >= today);
  const done = swaps.filter((s) => s.status === "odobreno" || s.status === "odbijeno").reverse().slice(0, 15);

  return (
    <main className="page">
      <header className="topbar">
        <Avatar name={org.name} />
        <div className="grow">
          <div className="eyebrow">{org.name}</div>
          <div className="title-sm">Zamjene</div>
        </div>
      </header>

      <section className="card hero stack">
        <div className="row between">
          <div>
            <div className="big-num silver-text">{waiting.length}</div>
            <div className="muted small">čeka tvoje odobrenje</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="title-sm">{offered.length}</div>
            <div className="faint small">ponuđeno, čeka kolegu</div>
          </div>
        </div>
      </section>

      {!setup && <div className="empty">Učitavam…</div>}

      {waiting.map((s) => {
        const sh = shift(s.shift_template_id);
        const warns = preview.get(s.id) ?? [];
        return (
          <section key={s.id} className="card stack">
            <div className="row">
              <Avatar name={name(s.from_employee_id)} size="sm" />
              <ArrowRight size={16} className="faint" />
              <Avatar name={name(s.accepted_by)} size="sm" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{name(s.from_employee_id)} → {name(s.accepted_by)}</div>
                <div className="small faint">{sh.label} · {fmtShort(s.date)} · {sh.time}</div>
              </div>
            </div>
            {warns.map((w) => (
              <div key={w} className="warn-box red"><Dot level="red" /><span>{w}</span></div>
            ))}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy === s.id} onClick={() => decide(s.id, true)}>
                <Check size={17} /> Odobri
              </button>
              <button className="btn btn-ghost" disabled={busy === s.id} onClick={() => decide(s.id, false)}><X size={16} /> Odbij</button>
            </div>
          </section>
        );
      })}

      {offered.length > 0 && (
        <section className="card stack">
          <div className="section-head"><span className="title-sm">Ponuđeno</span></div>
          {offered.map((s) => {
            const sh = shift(s.shift_template_id);
            return (
              <div key={s.id} className="card-inner row">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{name(s.from_employee_id)} nudi {s.to_employee_id ? `→ ${name(s.to_employee_id)}` : "svima"}</div>
                  <div className="small faint">{sh.label} · {fmtShort(s.date)} · {sh.time}</div>
                </div>
                <button className="btn btn-ghost btn-sm" disabled={busy === s.id} onClick={() => decide(s.id, false)}>Odbij</button>
              </div>
            );
          })}
        </section>
      )}

      {setup && !waiting.length && !offered.length && (
        <div className="empty">Nema otvorenih zamjena. Radnici nude smjene iz svoje aplikacije.</div>
      )}

      {done.length > 0 && (
        <section className="card stack">
          <div className="section-head"><span className="title-sm">Riješeno</span></div>
          {done.map((s) => (
            <div key={s.id} className="row small" style={{ justifyContent: "space-between" }}>
              <span>{name(s.from_employee_id)} → {name(s.accepted_by)} · {fmtShort(s.date)}</span>
              <span className={s.status === "odobreno" ? "muted" : "faint"}>{s.status === "odobreno" ? "Odobreno" : "Odbijeno"}</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
