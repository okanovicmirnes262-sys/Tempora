"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Repeat, Send, Undo2 } from "lucide-react";
import {
  addDays, dateRange, fmtDayMonth, hhmm, isoWeekday, mondayOf, monthEnd, monthStart,
  MONTHS, MONTHS_GEN, toDate, todayLocal, WEEKDAYS_SHORT, type DateStr,
} from "@/lib/dates";
import { cellKey, FREE_CELL, worstSeverity } from "@/lib/rules/engine";
import { holidaysBetween } from "@/lib/rules/holidays";
import { Avatar, Dot, errMsg, useToast } from "@/components/ui";
import { useOrg } from "./OwnerShell";
import { useSchedule } from "./useSchedule";
import { CellSheet, FreeSheet } from "./ScheduleSheets";

type View = "week" | "month";
type SheetState = { kind: "cell"; date: DateStr; tplId: string } | { kind: "free"; date: DateStr } | null;

function rangeLabel(view: View, from: DateStr, to: DateStr) {
  if (view === "month") {
    const d = toDate(from);
    const m = MONTHS[d.getUTCMonth()];
    return `${m[0].toUpperCase()}${m.slice(1)} ${d.getUTCFullYear()}.`;
  }
  const a = toDate(from), b = toDate(to);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}. – ${b.getUTCDate()}. ${MONTHS_GEN[b.getUTCMonth()]}`
    : `${fmtDayMonth(from)} – ${fmtDayMonth(to)}`;
}

export function Schedule() {
  const org = useOrg();
  const toast = useToast();
  const today = todayLocal();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<DateStr>(mondayOf(today));
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [autoFill, setAutoFill] = useState<{ assignmentIds: string[]; absenceIds: string[] } | null>(null);
  const tried = useRef(new Set<string>());

  useEffect(() => {
    try {
      const v = localStorage.getItem("raspored.view");
      if (v === "month") { setView("month"); setAnchor(monthStart(today)); }
    } catch { /* ignore */ }
  }, [today]);

  const from = view === "week" ? anchor : monthStart(anchor);
  const to = view === "week" ? addDays(anchor, 6) : monthEnd(anchor);
  const onError = useCallback((e: unknown) => toast(errMsg(e), "err"), [toast]);
  const s = useSchedule(org.id, org.country, from, to, onError);

  const switchView = (v: View) => {
    setView(v);
    setAnchor(v === "week" ? mondayOf(from <= today && today <= to ? today : from) : monthStart(from));
    try { localStorage.setItem("raspored.view", v); } catch { /* ignore */ }
  };
  const move = (dir: 1 | -1) => {
    setAutoFill(null);
    if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else {
      const d = toDate(monthStart(anchor));
      setAnchor(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1)).toISOString().slice(0, 10));
    }
  };

  // Prazan tjedan koji nije prošao: automatski popuni iz stalnih uzoraka.
  useEffect(() => {
    if (s.loading || !s.setup || view !== "week" || s.isPastWeek || s.weekHasAssignments) return;
    if (!s.setup.patterns.length || tried.current.has(from)) return;
    tried.current.add(from);
    s.applyPatterns().then((u) => {
      if (u.assignmentIds.length || u.absenceIds.length) setAutoFill(u);
    }).catch(onError);
  }, [s, view, from, onError]);

  const columns = useMemo(() => {
    if (!s.setup) return [];
    return s.setup.locations.map((l) => ({
      loc: l,
      tpls: s.setup!.templates.filter((t) => t.location_id === l.id && t.active),
    })).filter((c) => c.tpls.length);
  }, [s.setup]);

  const empOrder = useMemo(() => new Map((s.setup?.employees ?? []).map((e, i) => [e.id, i])), [s.setup]);
  const empName = useMemo(() => new Map((s.setup?.employees ?? []).map((e) => [e.id, e.name])), [s.setup]);
  const holidays = useMemo(() => (s.setup ? holidaysBetween(s.setup.rules, from, to) : new Map()), [s.setup, from, to]);
  const closedSet = useMemo(() => new Set(s.closures.map((c) => `${c.location_id}|${c.date}`)), [s.closures]);
  const cells = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of s.assignments) {
      if (a.date < from || a.date > to) continue;
      const k = cellKey(a.date, a.shift_template_id);
      m.set(k, [...(m.get(k) ?? []), a.employee_id]);
    }
    for (const v of m.values()) v.sort((x, y) => (empOrder.get(x) ?? 0) - (empOrder.get(y) ?? 0));
    return m;
  }, [s.assignments, from, to, empOrder]);

  const counts = useMemo(() => {
    let red = 0, yellow = 0;
    for (const w of s.warnings) {
      if (w.severity === "red") red++;
      else if (w.severity === "yellow") yellow++;
    }
    return { red, yellow };
  }, [s.warnings]);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    try {
      const msg = await fn();
      if (msg) toast(msg);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  const dates = dateRange(from, to);
  const month = view === "month";

  return (
    <main className="page wide">
      <header className="topbar">
        <Avatar name={org.name} />
        <div className="grow">
          <div className="eyebrow">{org.name}</div>
          <div className="title-sm">Raspored</div>
        </div>
        <button className="icon-btn" onClick={() => move(-1)} aria-label="Prethodno"><ChevronLeft size={20} /></button>
        <button className="icon-btn" onClick={() => move(1)} aria-label="Sljedeće"><ChevronRight size={20} /></button>
      </header>

      <section className="card hero stack" style={{ gap: 14 }}>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="big-num silver-text" style={{ fontSize: 34 }}>{rangeLabel(view, from, to)}</div>
            <button
              className="link-btn" style={{ marginTop: 6 }}
              onClick={() => { setAutoFill(null); setAnchor(view === "week" ? mondayOf(today) : monthStart(today)); }}
            >
              {from <= today && today <= to ? "Ovaj " + (month ? "mjesec" : "tjedan") : "Vrati na danas"}
            </button>
          </div>
          <div className="seg">
            <button className={!month ? "on" : ""} onClick={() => switchView("week")}>Tjedan</button>
            <button className={month ? "on" : ""} onClick={() => switchView("month")}>Mjesec</button>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          <span className="pill"><Dot level="red" /> {counts.red} upozorenja</span>
          <span className="pill"><Dot level="yellow" /> {counts.yellow} napomena</span>
          {s.unpublished > 0 && <span className="pill">{s.unpublished} neobjavljeno</span>}
        </div>

        <div className="hscroll">
          <button
            className="btn btn-primary" disabled={!!busy || s.loading}
            onClick={() => run("publish", async () => {
              const r = await s.publish();
              return r.changed
                ? `Objavljeno · obavijest za ${r.changed} radnika`
                : "Objavljeno · nema promjena za radnike";
            })}
          >
            <Send size={17} /> {busy === "publish" ? "Objavljujem…" : `Objavi${s.unpublished ? ` · ${s.unpublished}` : ""}`}
          </button>
          {!month && (
            <button
              className="btn btn-ghost" disabled={!!busy || s.loading}
              onClick={() => run("copy", async () => {
                const n = await s.copyPreviousWeek();
                return n ? `Kopirano ${n} smjena iz prošlog tjedna` : "Nema ništa novo za kopirati";
              })}
            >
              <Copy size={17} /> Kopiraj prošli tjedan
            </button>
          )}
          <button
            className="btn btn-ghost" disabled={!!busy || s.loading}
            onClick={() => run("patterns", async () => {
              const u = await s.applyPatterns();
              setAutoFill(u.assignmentIds.length || u.absenceIds.length ? u : null);
              return u.assignmentIds.length ? `Dodano ${u.assignmentIds.length} smjena iz stalnih uzoraka` : "Uzorci su već primijenjeni";
            })}
          >
            <Repeat size={17} /> Stalni uzorci
          </button>
        </div>

        {autoFill && (
          <div className="warn-box" style={{ alignItems: "center" }}>
            <span className="grow small" style={{ flex: 1 }}>
              Popunjeno iz stalnih uzoraka ({autoFill.assignmentIds.length} smjena). Promijeni samo iznimke.
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => run("undo", async () => { await s.undo(autoFill); setAutoFill(null); return "Poništeno"; })}
            >
              <Undo2 size={15} /> Poništi
            </button>
          </div>
        )}
      </section>

      <section className="card flush">
        {s.loading && !s.setup ? (
          <div className="empty">Učitavam raspored…</div>
        ) : !columns.length ? (
          <div className="empty">Nema lokala ni smjena. Dodaj ih u Postavkama.</div>
        ) : (
          <div className="sched-scroll">
            <table className={`sched ${month ? "month" : ""}`}>
              <thead>
                <tr>
                  <th className="day" rowSpan={2} />
                  {columns.map((c) => <th key={c.loc.id} colSpan={c.tpls.length}>{c.loc.name}</th>)}
                  <th rowSpan={2}>Slobodno / GO</th>
                </tr>
                <tr>
                  {columns.map((c) => c.tpls.map((t) => (
                    <th key={t.id}>
                      {t.name}
                      <span className="tpl-time">{hhmm(t.start_time)}–{hhmm(t.end_time)}</span>
                    </th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {dates.map((d) => {
                  const wd = isoWeekday(d);
                  const cls = [
                    d === today && "today", wd >= 6 && "weekend", holidays.has(d) && "holiday",
                    month && wd === 1 && d !== from && "week-start",
                  ].filter(Boolean).join(" ");
                  const freeKey = cellKey(d, FREE_CELL);
                  const off = s.absences.filter((a) => a.date_from <= d && a.date_to >= d)
                    .sort((x, y) => (empOrder.get(x.employee_id) ?? 0) - (empOrder.get(y.employee_id) ?? 0));
                  return (
                    <tr key={d} className={cls}>
                      <th className="day" title={holidays.get(d)}>
                        <b>{toDate(d).getUTCDate()}.</b>
                        <span>{holidays.has(d) ? "blagdan" : WEEKDAYS_SHORT[wd - 1]}</span>
                      </th>
                      {columns.map((c) => c.tpls.map((t) => {
                        const k = cellKey(d, t.id);
                        const closed = c.loc.closed_weekdays.includes(wd) || closedSet.has(`${c.loc.id}|${d}`);
                        const emps = cells.get(k) ?? [];
                        return (
                          <td
                            key={k}
                            className={`cell ${closed && !emps.length ? "closed" : ""} ${s.changedCells.has(k) ? "changed" : ""}`}
                            onClick={() => setSheet({ kind: "cell", date: d, tplId: t.id })}
                          >
                            <Dot level={worstSeverity(s.byCell.get(k))} />
                            {closed && !emps.length ? (
                              <span className="closed-label">Zatvoreno</span>
                            ) : (
                              <div className="chips">
                                {emps.map((e) => <span key={e} className="chip">{empName.get(e)}</span>)}
                              </div>
                            )}
                          </td>
                        );
                      }))}
                      <td className="cell free" onClick={() => setSheet({ kind: "free", date: d })}>
                        <Dot level={worstSeverity(s.byCell.get(freeKey))} />
                        <div className="chips">
                          {off.map((a) => (
                            <span key={a.id} className={`chip go ${a.type === "bolovanje" ? "sick" : ""}`}>
                              {empName.get(a.employee_id)}
                              {a.type === "godisnji" ? " · GO" : a.type === "bolovanje" ? " · bol." : ""}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {s.setup && <p className="note">{s.setup.rules.disclaimer}</p>}

      {sheet?.kind === "cell" && s.setup && s.data && (
        <CellSheet s={s} date={sheet.date} tplId={sheet.tplId} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === "free" && s.setup && s.data && (
        <FreeSheet s={s} date={sheet.date} onClose={() => setSheet(null)} />
      )}
    </main>
  );
}
