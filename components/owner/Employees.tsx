"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ChevronDown, Copy, MessageCircle, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import { fmtDM, hhmm, todayLocal, WEEKDAYS_INSTR, WEEKDAYS_SHORT } from "@/lib/dates";
import { ABSENCE_LABEL, type AbsenceType } from "@/lib/rules/types";
import {
  db, inviteText, loadSetup, must, whatsappLink, workerLink,
  type AbsenceRow, type AvailabilityRow, type EmployeeRow, type Setup,
} from "@/lib/owner/data";
import { Avatar, errMsg, useToast } from "@/components/ui";
import { useOrg } from "./OwnerShell";

export function Employees() {
  const org = useOrg();
  const toast = useToast();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [absences, setAbsences] = useState<AbsenceRow[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const reload = useCallback(async () => {
    const [s, ab, av] = await Promise.all([
      loadSetup(org.id, org.country),
      db().from("absences").select("id, employee_id, date_from, date_to, type").eq("org_id", org.id)
        .gte("date_to", todayLocal()).order("date_from"),
      db().from("availability").select("id, employee_id, date, weekday, note").eq("org_id", org.id),
    ]);
    setSetup(s);
    setAbsences(must(ab) as AbsenceRow[]);
    setAvailability(must(av) as AvailabilityRow[]);
  }, [org.id, org.country]);

  useEffect(() => { reload().catch((e) => toast(errMsg(e), "err")); }, [reload, toast]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const r = await db().from("employees")
      .insert({ org_id: org.id, name: name.trim(), phone: phone.trim() || null, sort_order: (setup?.employees.length ?? 0) + 1 })
      .select("id").single();
    if (r.error) return toast(errMsg(r.error), "err");
    setName(""); setPhone("");
    await reload();
    setOpen(r.data.id);
    toast("Radnik dodan — pošalji mu link");
  }

  const list = (setup?.employees ?? []).filter((e) => e.active || showArchived);
  const archived = (setup?.employees ?? []).filter((e) => !e.active).length;

  return (
    <main className="page">
      <header className="topbar">
        <Avatar name={org.name} />
        <div className="grow">
          <div className="eyebrow">{org.name}</div>
          <div className="title-sm">Radnici</div>
        </div>
      </header>

      <form className="card hero stack" onSubmit={add}>
        <div className="title-sm">Novi radnik</div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1.1 }} placeholder="Ime" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" style={{ flex: 1 }} placeholder="Mobitel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={!name.trim()}><Plus size={17} /> Dodaj</button>
      </form>

      {!setup && <div className="empty">Učitavam…</div>}
      {list.map((e) => (
        <EmployeeCard
          key={e.id} e={e} setup={setup!} open={open === e.id}
          onToggle={() => setOpen(open === e.id ? null : e.id)}
          absences={absences.filter((a) => a.employee_id === e.id)}
          availability={availability.filter((a) => a.employee_id === e.id)}
          reload={reload}
        />
      ))}
      {archived > 0 && (
        <button className="link-btn" style={{ alignSelf: "center" }} onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? "Sakrij arhivirane" : `Prikaži arhivirane (${archived})`}
        </button>
      )}
    </main>
  );
}

function EmployeeCard({ e, setup, open, onToggle, absences, availability, reload }: {
  e: EmployeeRow; setup: Setup; open: boolean; onToggle: () => void;
  absences: AbsenceRow[]; availability: AvailabilityRow[]; reload: () => Promise<void>;
}) {
  const org = useOrg();
  const toast = useToast();
  const [confirmToken, setConfirmToken] = useState(false);
  const [absType, setAbsType] = useState<AbsenceType>("godisnji");
  const [absFrom, setAbsFrom] = useState(todayLocal());
  const [absTo, setAbsTo] = useState(todayLocal());
  const link = typeof window === "undefined" ? "" : workerLink(e.token);
  const patterns = setup.patterns.filter((p) => p.employee_id === e.id);
  const tplLabel = (id: string) => {
    const t = setup.templates.find((x) => x.id === id);
    const l = t && setup.locations.find((x) => x.id === t.location_id);
    return t ? `${l?.name ?? ""} ${t.name}` : "";
  };

  async function save(patch: Partial<EmployeeRow>) {
    const r = await db().from("employees").update(patch).eq("id", e.id);
    if (r.error) return toast(errMsg(r.error), "err");
    await reload();
  }

  async function togglePattern(weekday: number, tplId: string | null) {
    const c = db();
    const existing = patterns.filter((p) => p.weekday === weekday);
    const same = existing.find((p) => (tplId ? p.shift_template_id === tplId : p.is_off));
    if (same) {
      await c.from("weekly_patterns").delete().eq("id", same.id);
    } else {
      // Slobodan dan i smjena se isključuju
      const clash = existing.filter((p) => (tplId ? p.is_off : !p.is_off)).map((p) => p.id);
      if (clash.length) await c.from("weekly_patterns").delete().in("id", clash);
      const r = await c.from("weekly_patterns").insert({
        org_id: org.id, employee_id: e.id, weekday, shift_template_id: tplId, is_off: !tplId,
      });
      if (r.error) toast(errMsg(r.error), "err");
    }
    await reload();
  }

  async function regenerate() {
    const r = await db().rpc("regenerate_employee_token", { p_employee: e.id });
    setConfirmToken(false);
    if (r.error) return toast(errMsg(r.error), "err");
    await reload();
    toast("Novi link je spreman — stari više ne radi");
  }

  const summary = patterns.filter((p) => !p.is_off).length;

  return (
    <section className="card" style={{ padding: 14 }}>
      <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={onToggle}>
        <Avatar name={e.name} dim={!e.active} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 17 }}>{e.name}</div>
          <div className="small faint">
            {e.employment_type === "puno" ? "Puno" : "Skraćeno"} · {e.weekly_hours} h tjedno
            {e.first_opened_at ? "" : " · link još nije otvoren"}
            {summary ? ` · ${summary} stalnih smjena` : ""}
          </div>
        </div>
        <ChevronDown size={20} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s", color: "var(--text-3)" }} />
      </button>

      {open && (
        <div className="stack" style={{ marginTop: 14, gap: 16 }}>
          <div className="row" style={{ gap: 8 }}>
            {e.phone && (
              <a className="btn btn-primary" style={{ flex: 1 }} href={whatsappLink(e.phone, inviteText(e.name, e.token))} target="_blank" rel="noreferrer">
                <MessageCircle size={17} /> Pošalji link
              </a>
            )}
            <button className="btn btn-ghost" style={{ flex: e.phone ? undefined : 1 }} onClick={() => { navigator.clipboard?.writeText(link); toast("Link kopiran"); }}>
              <Copy size={16} /> Kopiraj
            </button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="tiny faint" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link}</span>
            {!confirmToken ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmToken(true)}><RefreshCw size={14} /> Novi link</button>
            ) : (
              <>
                <button className="btn btn-danger btn-sm" onClick={regenerate}>Potvrdi · stari prestaje raditi</button>
                <button className="icon-btn sm" onClick={() => setConfirmToken(false)} aria-label="Odustani"><X size={15} /></button>
              </>
            )}
          </div>

          <div className="stack tight">
            <span className="label">Podaci</span>
            <div className="row" style={{ gap: 8 }}>
              <input className="input sm" defaultValue={e.name} onBlur={(ev) => ev.target.value.trim() && ev.target.value !== e.name && save({ name: ev.target.value.trim() })} />
              <input className="input sm" defaultValue={e.phone ?? ""} inputMode="tel" placeholder="Mobitel" onBlur={(ev) => ev.target.value !== (e.phone ?? "") && save({ phone: ev.target.value.trim() || null })} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="seg" style={{ flex: 1 }}>
                <button className={e.employment_type === "puno" ? "on" : ""} onClick={() => save({ employment_type: "puno", weekly_hours: 40 })}>Puno</button>
                <button className={e.employment_type === "skraceno" ? "on" : ""} onClick={() => save({ employment_type: "skraceno", weekly_hours: e.employment_type === "skraceno" ? e.weekly_hours : 20 })}>Skraćeno</button>
              </div>
              <input
                key={e.weekly_hours} className="input sm" style={{ width: 84 }} type="number" min={0} max={60} step={0.5}
                defaultValue={e.weekly_hours} aria-label="Ugovoreni tjedni sati"
                onBlur={(ev) => Number(ev.target.value) !== e.weekly_hours && save({ weekly_hours: Number(ev.target.value) })}
              />
              <span className="small faint">h/tj.</span>
            </div>
          </div>

          <div className="stack tight">
            <span className="label">Stalni tjedni uzorak</span>
            {WEEKDAYS_SHORT.map((wd, i) => {
              const day = i + 1;
              const isOff = patterns.some((p) => p.weekday === day && p.is_off);
              return (
                <div key={wd} className="row" style={{ gap: 8 }}>
                  <span style={{ width: 34, fontWeight: 600, textTransform: "capitalize" }} className="small">{wd}</span>
                  <div className="hscroll" style={{ flex: 1 }}>
                    <button className={`pill ${isOff ? "on" : ""}`} onClick={() => togglePattern(day, null)}>Slobodan</button>
                    {setup.templates.filter((t) => t.active).map((t) => {
                      const on = patterns.some((p) => p.weekday === day && p.shift_template_id === t.id);
                      return (
                        <button key={t.id} className={`pill ${on ? "on" : ""}`} onClick={() => togglePattern(day, t.id)} title={`${hhmm(t.start_time)}–${hhmm(t.end_time)}`}>
                          {tplLabel(t.id)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="stack tight">
            <span className="label">Godišnji, bolovanje, slobodni dani</span>
            {absences.filter((a) => a.type !== "slobodan" || a.date_from !== a.date_to).map((a) => (
              <div key={a.id} className="card-inner row">
                <span style={{ flex: 1 }}>{ABSENCE_LABEL[a.type]} · {fmtDM(a.date_from)}–{fmtDM(a.date_to)}</span>
                <button className="icon-btn sm" onClick={async () => { await db().from("absences").delete().eq("id", a.id); reload(); }} aria-label="Ukloni"><X size={15} /></button>
              </div>
            ))}
            <div className="seg block">
              {(["godisnji", "bolovanje", "slobodan"] as AbsenceType[]).map((t) => (
                <button key={t} className={absType === t ? "on" : ""} onClick={() => setAbsType(t)}>{ABSENCE_LABEL[t]}</button>
              ))}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input className="input sm" type="date" value={absFrom} onChange={(ev) => { setAbsFrom(ev.target.value); if (ev.target.value > absTo) setAbsTo(ev.target.value); }} />
              <input className="input sm" type="date" value={absTo} min={absFrom} onChange={(ev) => setAbsTo(ev.target.value)} />
              <button
                className="icon-btn" aria-label="Dodaj odsutnost"
                onClick={async () => {
                  const r = await db().from("absences").insert({ org_id: org.id, employee_id: e.id, date_from: absFrom, date_to: absTo, type: absType });
                  if (r.error) return toast(errMsg(r.error), "err");
                  toast("Dodano");
                  reload();
                }}
              ><Plus size={18} /></button>
            </div>
          </div>

          {availability.length > 0 && (
            <div className="stack tight">
              <span className="label">Ne može raditi (upisao radnik)</span>
              {availability.map((a) => (
                <div key={a.id} className="card-inner row">
                  <span style={{ flex: 1 }}>
                    {a.weekday ? `Stalno ${WEEKDAYS_INSTR[a.weekday - 1]}` : fmtDM(a.date!)}
                    {a.note ? <span className="faint"> · {a.note}</span> : null}
                  </span>
                  <button className="icon-btn sm" onClick={async () => { await db().from("availability").delete().eq("id", a.id); reload(); }} aria-label="Ukloni"><X size={15} /></button>
                </div>
              ))}
            </div>
          )}

          <button className="btn btn-ghost" onClick={() => save({ active: !e.active })}>
            {e.active ? <><Archive size={16} /> Arhiviraj (više ne radi)</> : <><RotateCcw size={16} /> Vrati u aktivne</>}
          </button>
        </div>
      )}
    </section>
  );
}
