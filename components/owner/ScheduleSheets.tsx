"use client";

import { useMemo, useState } from "react";
import { Check, Lock, Plus, Sparkles, X } from "lucide-react";
import { addDays, fmtDM, fmtHours, fmtShort, hhmm, isoWeekday, mondayOf, WEEKDAYS_INSTR, type DateStr } from "@/lib/dates";
import { cellKey, FREE_CELL, ScheduleIndex, suggestReplacements, templateMinutes } from "@/lib/rules/engine";
import { ABSENCE_LABEL, type AbsenceType, type Warning } from "@/lib/rules/types";
import { Dot, Sheet } from "@/components/ui";
import type { ScheduleApi } from "./useSchedule";

function Warnings({ list }: { list: Warning[] }) {
  const sorted = [...list].sort((a, b) => rank(a) - rank(b));
  if (!sorted.length) return null;
  return (
    <div className="stack tight">
      {sorted.map((w, i) => (
        <div key={i} className={`warn-box ${w.severity}`}>
          <Dot level={w.severity} />
          <span>{w.message}</span>
        </div>
      ))}
    </div>
  );
}
const rank = (w: Warning) => (w.severity === "red" ? 0 : w.severity === "yellow" ? 1 : 2);

export function CellSheet({ s, date, tplId, onClose }: { s: ScheduleApi; date: DateStr; tplId: string; onClose: () => void }) {
  const setup = s.setup!;
  const data = s.data!;
  const tpl = setup.templates.find((t) => t.id === tplId)!;
  const loc = setup.locations.find((l) => l.id === tpl.location_id)!;
  const ix = useMemo(() => new ScheduleIndex(data), [data]);
  const warnings = s.byCell.get(cellKey(date, tplId)) ?? [];
  const assigned = new Set(s.assignments.filter((a) => a.date === date && a.shift_template_id === tplId).map((a) => a.employee_id));
  const closedByWeekday = loc.closed_weekdays.includes(isoWeekday(date));
  const closed = closedByWeekday || s.closures.some((c) => c.location_id === loc.id && c.date === date);
  const needsHelp = warnings.some((w) => w.severity !== "info");
  const suggestions = useMemo(
    () => (needsHelp ? suggestReplacements(data, date, tplId).slice(0, 4) : []),
    [needsHelp, data, date, tplId],
  );

  const monday = mondayOf(date);
  const weekMinutes = (empId: string) =>
    (ix.shiftsByEmp.get(empId) ?? [])
      .filter((x) => x.date >= monday && x.date <= addDays(monday, 6))
      .reduce((sum, x) => sum + (x.end - x.start), 0);

  function status(empId: string): { text: string; tone?: "warn" | "bad" } {
    const abs = ix.absence(empId, date);
    if (abs) return { text: abs.type === "slobodan" ? "Slobodan dan" : ABSENCE_LABEL[abs.type], tone: abs.type === "slobodan" ? "warn" : "bad" };
    const u = ix.unavailable(empId, date);
    if (u) return { text: `Ne može ${u.weekday ? WEEKDAYS_INSTR[u.weekday - 1] : "taj dan"}${u.note ? ` · ${u.note}` : ""}`, tone: "bad" };
    const other = ix.shiftsOn(empId, date).filter((x) => x.template.id !== tplId);
    if (other.length) return { text: `Radi ${other.map((x) => ix.label(x.template)).join(", ")}`, tone: "warn" };
    return { text: `${fmtHours(weekMinutes(empId))} h ovaj tjedan` };
  }

  return (
    <Sheet open onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row between">
          <div>
            <div className="eyebrow">{fmtShort(date)} · {hhmm(tpl.start_time)}–{hhmm(tpl.end_time)} · {fmtHours(templateMinutes(tpl))} h</div>
            <div className="title-sm">{loc.name} · {tpl.name}</div>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Zatvori"><X size={18} /></button>
        </div>

        <Warnings list={warnings} />

        {suggestions.length > 0 && (
          <div className="stack tight">
            <span className="label"><Sparkles size={12} style={{ verticalAlign: -1 }} /> Može uskočiti</span>
            <div className="row wrap" style={{ gap: 8 }}>
              {suggestions.map((sg) => (
                <button key={sg.employee.id} className="pill" onClick={() => s.toggleAssignment(date, tplId, sg.employee.id)}>
                  <Plus size={14} /> {sg.employee.name} <span className="faint">— {sg.note}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="stack tight">
          <span className="label">Radnici · tapni za dodavanje ili uklanjanje</span>
          {setup.employees.filter((e) => e.active || assigned.has(e.id)).map((e) => {
            const on = assigned.has(e.id);
            const st = status(e.id);
            return (
              <button key={e.id} className={`pick ${on ? "on" : ""}`} onClick={() => s.toggleAssignment(date, tplId, e.id)}>
                <span className="check">{on && <Check size={16} strokeWidth={3} />}</span>
                <span className="grow">
                  <div style={{ fontWeight: 600 }}>{e.name}</div>
                  <div className={`sub ${st.tone ?? ""}`}>{st.text}</div>
                </span>
              </button>
            );
          })}
        </div>

        <button
          className={`pick ${closed ? "on" : ""}`}
          disabled={closedByWeekday}
          onClick={() => s.toggleClosure(loc.id, date)}
        >
          <span className="check">{closed && <Lock size={14} strokeWidth={2.6} />}</span>
          <span className="grow">
            <div style={{ fontWeight: 600 }}>{loc.name} zatvoren {fmtShort(date)}</div>
            <div className="sub">{closedByWeekday ? `Zatvoreno ${WEEKDAYS_INSTR[isoWeekday(date) - 1]} (Postavke)` : "Prazne smjene tada nisu upozorenje"}</div>
          </span>
        </button>
      </div>
    </Sheet>
  );
}

export function FreeSheet({ s, date, onClose }: { s: ScheduleApi; date: DateStr; onClose: () => void }) {
  const setup = s.setup!;
  const warnings = s.byCell.get(cellKey(date, FREE_CELL)) ?? [];
  const active = setup.employees.filter((e) => e.active);
  const [emp, setEmp] = useState(active[0]?.id ?? "");
  const [type, setType] = useState<AbsenceType>("godisnji");
  const [dFrom, setDFrom] = useState(date);
  const [dTo, setDTo] = useState(date);
  const [adding, setAdding] = useState(false);

  return (
    <Sheet open onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row between">
          <div>
            <div className="eyebrow">{fmtShort(date)}</div>
            <div className="title-sm">Slobodno / GO</div>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Zatvori"><X size={18} /></button>
        </div>

        <Warnings list={warnings} />

        <div className="stack tight">
          <span className="label">Tapni za slobodan dan</span>
          {active.map((e) => {
            const abs = s.absences.find((a) => a.employee_id === e.id && a.date_from <= date && a.date_to >= date);
            const works = s.assignments.some((a) => a.employee_id === e.id && a.date === date);
            const range = abs && abs.date_from !== abs.date_to;
            const locked = abs && (abs.type !== "slobodan" || range);
            return (
              <div key={e.id} className="row" style={{ gap: 8 }}>
                <button
                  className={`pick ${abs ? "on" : ""}`}
                  onClick={() => !locked && s.toggleFree(date, e.id)}
                  style={{ flex: 1 }}
                >
                  <span className="check">{abs && <Check size={16} strokeWidth={3} />}</span>
                  <span className="grow">
                    <div style={{ fontWeight: 600 }}>{e.name}</div>
                    <div className={`sub ${abs?.type === "bolovanje" || (!abs && !works) ? "warn" : ""}`}>
                      {abs
                        ? `${ABSENCE_LABEL[abs.type]}${range ? ` · ${fmtDM(abs.date_from)}–${fmtDM(abs.date_to)}` : ""}`
                        : works ? "Radi taj dan" : "Nije označen"}
                    </div>
                  </span>
                </button>
                {locked && (
                  <button className="icon-btn sm" onClick={() => s.removeAbsence(abs!.id)} aria-label="Ukloni odsutnost">
                    <X size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {!adding ? (
          <button className="btn btn-ghost" onClick={() => setAdding(true)}><Plus size={17} /> Godišnji ili bolovanje (od – do)</button>
        ) : (
          <div className="card-inner stack">
            <div className="seg block">
              {(["godisnji", "bolovanje", "slobodan"] as AbsenceType[]).map((t) => (
                <button key={t} className={type === t ? "on" : ""} onClick={() => setType(t)}>{ABSENCE_LABEL[t]}</button>
              ))}
            </div>
            <select className="select" value={emp} onChange={(e) => setEmp(e.target.value)}>
              {active.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <div className="grid2">
              <div><span className="label">Od</span><input className="input" type="date" value={dFrom} onChange={(e) => { setDFrom(e.target.value); if (e.target.value > dTo) setDTo(e.target.value); }} /></div>
              <div><span className="label">Do</span><input className="input" type="date" value={dTo} min={dFrom} onChange={(e) => setDTo(e.target.value)} /></div>
            </div>
            <button
              className="btn btn-primary"
              disabled={!emp || !dFrom || !dTo || dTo < dFrom}
              onClick={async () => { await s.addAbsence(emp, type, dFrom, dTo); setAdding(false); }}
            >
              Dodaj
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
