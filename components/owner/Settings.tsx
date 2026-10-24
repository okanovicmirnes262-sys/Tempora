"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Download, LogOut, Plus, Trash2 } from "lucide-react";
import { APP } from "@/lib/config";
import { hhmm, MONTHS, todayLocal, WEEKDAYS_SHORT } from "@/lib/dates";
import { db, loadSetup, type LocationRow, type Setup, type TemplateRow } from "@/lib/owner/data";
import { hasPushSubscription, subscribePush } from "@/lib/push-client";
import { Avatar, errMsg, useToast } from "@/components/ui";
import { useOrg } from "./OwnerShell";

export function Settings() {
  const org = useOrg();
  const toast = useToast();
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [newLoc, setNewLoc] = useState("");

  const reload = useCallback(async () => setSetup(await loadSetup(org.id, org.country)), [org.id, org.country]);
  useEffect(() => {
    reload().catch((e) => toast(errMsg(e), "err"));
    hasPushSubscription().then(setPushOn).catch(() => {});
  }, [reload, toast]);

  async function run(p: PromiseLike<{ error: { message: string } | null }>) {
    const r = await p;
    if (r.error) toast(errMsg(r.error), "err");
    await reload();
  }

  async function enablePush() {
    try {
      const s = await subscribePush();
      const { data: u } = await db().auth.getUser();
      await db().from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      const r = await db().from("push_subscriptions").insert({ org_id: org.id, user_id: u.user!.id, ...s });
      if (r.error) throw r.error;
      setPushOn(true);
      const t = await fetch("/api/push/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId: org.id }) });
      toast(t.ok ? "Obavijesti uključene — poslana je probna" : "Obavijesti uključene");
    } catch (e) {
      toast(errMsg(e), "err");
    }
  }

  async function logout() {
    await db().auth.signOut();
    router.replace("/prijava");
  }

  // Mjeseci za izvoz: tekući i 11 prethodnih
  const months = Array.from({ length: 12 }, (_, i) => {
    const [y, m] = todayLocal().slice(0, 7).split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return { v: d.toISOString().slice(0, 7), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}.` };
  });

  return (
    <main className="page">
      <header className="topbar">
        <Avatar name={org.name} />
        <div className="grow">
          <div className="eyebrow">{org.email}</div>
          <div className="title-sm">Postavke</div>
        </div>
        <button className="icon-btn" onClick={logout} aria-label="Odjava"><LogOut size={19} /></button>
      </header>

      <section className="card hero stack">
        <div className="row">
          <span className="glass-icon" style={{ width: 52, height: 52, borderRadius: 18 }}><Download size={22} /></span>
          <div>
            <div className="title-sm">Izvoz za knjigovođu</div>
            <div className="small muted">Excel: ukupni, redovni, noćni, nedjeljni, blagdanski i prekovremeni sati.</div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select className="select" value={month} onChange={(e) => setMonth(e.target.value)} style={{ flex: 1, textTransform: "capitalize" }}>
            {months.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
          <a className="btn btn-primary" href={`/api/export?org=${org.id}&month=${month}`}><Download size={17} /> Preuzmi</a>
        </div>
      </section>

      <section className="card stack">
        <div className="row between">
          <div>
            <div className="title-sm">Obavijesti</div>
            <div className="small faint">Zamjene koje čekaju tvoje odobrenje.</div>
          </div>
          <button className={`btn ${pushOn ? "btn-ghost" : "btn-primary"} btn-sm`} onClick={enablePush}>
            <Bell size={15} /> {pushOn ? "Uključeno · proba" : "Uključi"}
          </button>
        </div>
      </section>

      <section className="card stack">
        <div className="title-sm">Naziv</div>
        <input
          className="input" defaultValue={org.name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== org.name && run(db().from("organizations").update({ name: e.target.value.trim() }).eq("id", org.id)).then(() => router.refresh())}
        />
      </section>

      <div className="section-head"><span className="title-sm">Lokali i smjene</span></div>
      {setup?.locations.map((l) => (
        <LocationCard key={l.id} l={l} templates={setup.templates.filter((t) => t.location_id === l.id)} run={run} orgId={org.id} />
      ))}
      <form
        className="card row" style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!newLoc.trim()) return;
          run(db().from("locations").insert({ org_id: org.id, name: newLoc.trim(), sort_order: (setup?.locations.length ?? 0) + 1 }));
          setNewLoc("");
        }}
      >
        <input className="input" placeholder="Novi lokal" value={newLoc} onChange={(e) => setNewLoc(e.target.value)} />
        <button className="icon-btn" aria-label="Dodaj lokal"><Plus size={18} /></button>
      </form>

      <p className="note">{setup?.rules.disclaimer}</p>
      <p className="note">{APP.name} · pravila: Zakon o radu (HR)</p>
    </main>
  );
}

function LocationCard({ l, templates, run, orgId }: {
  l: LocationRow; templates: TemplateRow[]; orgId: string;
  run: (p: PromiseLike<{ error: { message: string } | null }>) => Promise<void>;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const toggleWeekday = (d: number) => {
    const next = l.closed_weekdays.includes(d) ? l.closed_weekdays.filter((x) => x !== d) : [...l.closed_weekdays, d].sort();
    run(db().from("locations").update({ closed_weekdays: next }).eq("id", l.id));
  };
  return (
    <section className="card stack">
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input" style={{ fontWeight: 600 }} defaultValue={l.name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && run(db().from("locations").update({ name: e.target.value.trim() }).eq("id", l.id))}
        />
        {!confirmDel ? (
          <button className="icon-btn" onClick={() => setConfirmDel(true)} aria-label="Obriši lokal"><Trash2 size={17} /></button>
        ) : (
          <button className="btn btn-danger btn-sm" onClick={() => run(db().from("locations").delete().eq("id", l.id))}>Obriši sve</button>
        )}
      </div>

      {templates.map((t) => (
        <div key={t.id} className="card-inner stack tight" style={{ opacity: t.active ? 1 : 0.45 }}>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input sm" style={{ flex: 1 }} defaultValue={t.name} aria-label="Naziv smjene"
              onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && run(db().from("shift_templates").update({ name: e.target.value.trim() }).eq("id", t.id))}
            />
            <button className="icon-btn sm" aria-label={t.active ? "Isključi smjenu" : "Uključi smjenu"}
              onClick={() => run(db().from("shift_templates").update({ active: !t.active }).eq("id", t.id))}>
              {t.active ? <Trash2 size={15} /> : <Plus size={15} />}
            </button>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input className="input sm" style={{ flex: 1 }} type="time" defaultValue={hhmm(t.start_time)} aria-label="Početak"
              onBlur={(e) => e.target.value && e.target.value !== hhmm(t.start_time) && run(db().from("shift_templates").update({ start_time: e.target.value }).eq("id", t.id))} />
            <span className="faint">–</span>
            <input className="input sm" style={{ flex: 1 }} type="time" defaultValue={hhmm(t.end_time)} aria-label="Kraj"
              onBlur={(e) => e.target.value && e.target.value !== hhmm(t.end_time) && run(db().from("shift_templates").update({ end_time: e.target.value }).eq("id", t.id))} />
          </div>
        </div>
      ))}
      <button
        className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}
        onClick={() => run(db().from("shift_templates").insert({
          org_id: orgId, location_id: l.id, name: templates.length ? "Nova smjena" : "Dnevna",
          start_time: "09:00", end_time: "17:00", sort_order: templates.length + 1,
        }))}
      >
        <Plus size={15} /> Smjena
      </button>

      <div className="stack tight">
        <span className="label">Stalno zatvoreno</span>
        <div className="row" style={{ gap: 6 }}>
          {WEEKDAYS_SHORT.map((w, i) => (
            <button key={w} className={`pill ${l.closed_weekdays.includes(i + 1) ? "on" : ""}`} style={{ padding: "0 9px" }} onClick={() => toggleWeekday(i + 1)}>
              {w}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
