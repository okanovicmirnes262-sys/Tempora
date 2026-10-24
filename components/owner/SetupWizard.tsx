"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Copy, MessageCircle, Plus, Trash2 } from "lucide-react";
import { APP } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase/client";
import { inviteText, must, whatsappLink, workerLink } from "@/lib/owner/data";
import { Avatar, errMsg, useToast } from "@/components/ui";

type Preset = "one" | "two";
interface Loc { name: string; preset: Preset; one: [string, string]; morning: [string, string]; afternoon: [string, string] }
interface Emp { name: string; phone: string }

const newLoc = (name = ""): Loc => ({
  name, preset: "one", one: ["09:00", "17:00"], morning: ["09:00", "15:00"], afternoon: ["15:00", "21:00"],
});

export function SetupWizard() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [locs, setLocs] = useState<Loc[]>([newLoc(), newLoc()]);
  const [emps, setEmps] = useState<Emp[]>([{ name: "", phone: "" }, { name: "", phone: "" }, { name: "", phone: "" }]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; phone: string | null; token: string }[] | null>(null);

  const validLocs = locs.filter((l) => l.name.trim());
  const validEmps = emps.filter((e) => e.name.trim());
  const updLoc = (i: number, p: Partial<Loc>) => setLocs((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const updEmp = (i: number, p: Partial<Emp>) => setEmps((es) => es.map((e, j) => (j === i ? { ...e, ...p } : e)));

  async function finish() {
    setBusy(true);
    try {
      const c = supabaseBrowser();
      const orgId = must(await c.rpc("create_organization", { p_name: validLocs.map((l) => l.name.trim()).join(" & ") })) as string;
      const locRows = must(await c.from("locations")
        .insert(validLocs.map((l, i) => ({ org_id: orgId, name: l.name.trim(), sort_order: i + 1 })))
        .select("id, sort_order")) as { id: string; sort_order: number }[];
      const tpls = validLocs.flatMap((l, i) => {
        const location_id = locRows.find((r) => r.sort_order === i + 1)!.id;
        return l.preset === "one"
          ? [{ org_id: orgId, location_id, name: "Dnevna", start_time: l.one[0], end_time: l.one[1], sort_order: 1 }]
          : [
              { org_id: orgId, location_id, name: "Jutro", start_time: l.morning[0], end_time: l.morning[1], sort_order: 1 },
              { org_id: orgId, location_id, name: "Popodne", start_time: l.afternoon[0], end_time: l.afternoon[1], sort_order: 2 },
            ];
      });
      must(await c.from("shift_templates").insert(tpls));
      const empRows = validEmps.length
        ? (must(await c.from("employees")
            .insert(validEmps.map((e, i) => ({ org_id: orgId, name: e.name.trim(), phone: e.phone.trim() || null, sort_order: i + 1 })))
            .select("name, phone, token, sort_order")) as { name: string; phone: string | null; token: string; sort_order: number }[])
        : [];
      setCreated(empRows.sort((a, b) => a.sort_order - b.sort_order));
      setStep(4);
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        {step > 1 && step < 4 ? (
          <button className="icon-btn" onClick={() => setStep(step - 1)} aria-label="Natrag"><ArrowLeft size={20} /></button>
        ) : <span className="avatar">{APP.name[0]}</span>}
        <div className="grow">
          <div className="eyebrow">{step < 4 ? `Korak ${step} od 3` : "Gotovo"}</div>
          <div className="title-sm">{["", "Tvoji lokali", "Smjene", "Radnici", "Pošalji linkove"][step]}</div>
        </div>
      </header>
      <div className="steps">{[1, 2, 3].map((i) => <i key={i} className={step >= i ? "on" : ""} />)}</div>

      {step === 1 && (
        <section className="card stack">
          <p className="muted small">Upiši nazive lokala. Isti radnici rade u svima.</p>
          {locs.map((l, i) => (
            <div key={i} className="row">
              <input className="input" placeholder={i === 0 ? "npr. Barone" : "npr. Arsen"} value={l.name} onChange={(e) => updLoc(i, { name: e.target.value })} />
              {locs.length > 1 && (
                <button className="icon-btn" onClick={() => setLocs(locs.filter((_, j) => j !== i))} aria-label="Ukloni"><Trash2 size={18} /></button>
              )}
            </div>
          ))}
          <button className="btn btn-ghost" onClick={() => setLocs([...locs, newLoc()])}><Plus size={17} /> Još jedan lokal</button>
          <button className="btn btn-primary" disabled={!validLocs.length} onClick={() => { setLocs(validLocs); setStep(2); }}>
            Dalje <ArrowRight size={18} />
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="stack">
          {locs.map((l, i) => (
            <div key={i} className="card stack">
              <div className="title-sm">{l.name}</div>
              <div className="seg block">
                <button className={l.preset === "one" ? "on" : ""} onClick={() => updLoc(i, { preset: "one" })}>Jedna smjena</button>
                <button className={l.preset === "two" ? "on" : ""} onClick={() => updLoc(i, { preset: "two" })}>Jutro + popodne</button>
              </div>
              {l.preset === "one" ? (
                <TimeRow label="Dnevna" v={l.one} on={(v) => updLoc(i, { one: v })} />
              ) : (
                <>
                  <TimeRow label="Jutro" v={l.morning} on={(v) => updLoc(i, { morning: v, afternoon: [v[1], l.afternoon[1]] })} />
                  <TimeRow label="Popodne" v={l.afternoon} on={(v) => updLoc(i, { afternoon: v })} />
                </>
              )}
            </div>
          ))}
          <button className="btn btn-primary" onClick={() => setStep(3)}>Dalje <ArrowRight size={18} /></button>
        </section>
      )}

      {step === 3 && (
        <section className="card stack">
          <p className="muted small">Ime i mobitel (za WhatsApp). Svaki radnik dobiva osobni link — bez lozinke.</p>
          {emps.map((e, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <input className="input" style={{ flex: 1.1 }} placeholder="Ime" value={e.name} onChange={(ev) => updEmp(i, { name: ev.target.value })} />
              <input className="input" style={{ flex: 1 }} placeholder="091 234 5678" inputMode="tel" value={e.phone} onChange={(ev) => updEmp(i, { phone: ev.target.value })} />
            </div>
          ))}
          <button className="btn btn-ghost" onClick={() => setEmps([...emps, { name: "", phone: "" }])}><Plus size={17} /> Još jedan radnik</button>
          <button className="btn btn-primary" disabled={busy} onClick={finish}>
            {busy ? "Spremam…" : <>Završi <Check size={18} /></>}
          </button>
        </section>
      )}

      {step === 4 && created && (
        <section className="stack">
          <div className="card stack">
            {!created.length && <div className="empty">Radnike možeš dodati kasnije u izborniku Radnici.</div>}
            {created.map((e) => (
              <div key={e.token} className="card-inner row">
                <Avatar name={e.name} size="sm" />
                <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{e.name}</div>
                  <div className="tiny faint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workerLink(e.token)}</div>
                </div>
                <button className="icon-btn sm" aria-label="Kopiraj" onClick={() => { navigator.clipboard?.writeText(workerLink(e.token)); toast("Link kopiran"); }}>
                  <Copy size={16} />
                </button>
                {e.phone && (
                  <a className="icon-btn sm" aria-label="WhatsApp" href={whatsappLink(e.phone, inviteText(e.name, e.token))} target="_blank" rel="noreferrer">
                    <MessageCircle size={16} />
                  </a>
                )}
              </div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => router.replace("/raspored")}>Na raspored <ArrowRight size={18} /></button>
        </section>
      )}
    </main>
  );
}

function TimeRow({ label, v, on }: { label: string; v: [string, string]; on: (v: [string, string]) => void }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <span style={{ width: 74, fontWeight: 600 }}>{label}</span>
      <input className="input sm" type="time" value={v[0]} onChange={(e) => on([e.target.value, v[1]])} />
      <span className="faint">–</span>
      <input className="input sm" type="time" value={v[1]} onChange={(e) => on([v[0], e.target.value])} />
    </div>
  );
}
