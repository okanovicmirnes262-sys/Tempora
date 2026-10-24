"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight, Bell, BellRing, CalendarX2, Check, Clock, House, Plus, Share, Smartphone, X,
} from "lucide-react";
import { APP } from "@/lib/config";
import {
  addDays, dateRange, fmtDM, fmtHours, fmtShort, isoWeekday, mondayOf, monthEnd, monthStart,
  MONTHS_GEN, nowLocalMinutes, toDate, todayLocal, WEEKDAYS_INSTR, WEEKDAYS_LONG, WEEKDAYS_SHORT, type DateStr,
} from "@/lib/dates";
import { workedMinutes } from "@/lib/rules/hours";
import { shiftBounds } from "@/lib/rules/engine";
import { supabaseBrowser } from "@/lib/supabase/client";
import { hasPushSubscription, isIOS, isStandalone, registerSW, subscribePush } from "@/lib/push-client";
import { Avatar, Dock, errMsg, useToast } from "@/components/ui";

interface Shift { date: string; shift_template_id: string; shift: string; location: string; start: string; end: string; coworkers: string[] }
interface Swap {
  id: string; date: string; status: "ponudeno" | "prihvaceno" | "odobreno" | "odbijeno";
  shift_template_id: string; shift: string; location: string; start: string; end: string;
  from_name: string; to_name: string | null; accepted_name: string | null;
  mine: boolean; accepted_by_me: boolean; can_accept: boolean;
}
interface Bundle {
  me: { id: string; name: string; weekly_hours: number; employment_type: string; first_open: boolean };
  org: { name: string };
  shifts: Shift[];
  absences: { id: string; from: string; to: string; type: "godisnji" | "slobodan" | "bolovanje" }[];
  availability: { id: string; date: string | null; weekday: number | null; note: string | null }[];
  colleagues: { id: string; name: string }[];
  swaps: Swap[];
}
type Tab = "home" | "zamjene" | "dostupnost";
type InstallEvent = Event & { prompt: () => Promise<void> };

const ABS = { godisnji: "Godišnji odmor", slobodan: "Slobodan dan", bolovanje: "Bolovanje" };
const STATUS = { ponudeno: "Ponuđeno", prihvaceno: "Čeka odobrenje", odobreno: "Odobreno", odbijeno: "Odbijeno" };

export function WorkerApp({ token }: { token: string }) {
  const toast = useToast();
  const [b, setB] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [now, setNow] = useState(() => nowLocalMinutes(APP.timeZone));
  const today = todayLocal(APP.timeZone);
  const weekFrom = mondayOf(today);
  const weekTo = addDays(weekFrom, 6);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("w_bundle", { p_token: token, p_from: weekFrom, p_to: addDays(today, 45) });
    if (error) return setError(error.message === "Neispravan link" ? "Ovaj link više ne vrijedi. Zatraži novi od poslodavca." : error.message);
    setB(data as Bundle);
    setNow(nowLocalMinutes(APP.timeZone));
  }, [token, weekFrom, today]);

  useEffect(() => {
    load();
    registerSW()?.catch(() => {});
    const t = new URLSearchParams(location.search).get("tab");
    if (t === "zamjene" || t === "dostupnost") setTab(t);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  async function swapAction(payload: Record<string, unknown>, ok: string) {
    const res = await fetch("/api/w/swap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, ...payload }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast(body.error ?? "Nije uspjelo", "err");
    toast(ok);
    load();
  }

  if (error) {
    return (
      <main className="page" style={{ justifyContent: "center", minHeight: "100dvh" }}>
        <div className="card hero stack" style={{ textAlign: "center", alignItems: "center" }}>
          <span className="glass-icon"><X size={28} /></span>
          <div className="title-sm">{error}</div>
        </div>
      </main>
    );
  }
  if (!b) return <main className="page"><div className="empty" style={{ marginTop: "40dvh" }}>Učitavam tvoje smjene…</div></main>;

  return (
    <>
      {tab === "home" && <Home b={b} today={today} now={now} weekFrom={weekFrom} weekTo={weekTo} token={token} goSwap={() => setTab("zamjene")} />}
      {tab === "zamjene" && <Swaps b={b} today={today} now={now} act={swapAction} />}
      {tab === "dostupnost" && <Availability b={b} token={token} today={today} reload={load} />}
      <Dock
        items={[
          { icon: House, label: "Moje smjene", active: tab === "home", onClick: () => setTab("home") },
          { icon: ArrowLeftRight, label: "Zamjene", active: tab === "zamjene", onClick: () => setTab("zamjene"), badge: b.swaps.filter((s) => s.can_accept).length },
          { icon: CalendarX2, label: "Ne mogu raditi", active: tab === "dostupnost", onClick: () => setTab("dostupnost") },
        ]}
      />
    </>
  );
}

function Header({ b, right }: { b: Bundle; right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Avatar name={b.me.name} />
      <div className="grow">
        <div className="eyebrow">{b.org.name}</div>
        <div className="title-sm">Bok, {b.me.name}</div>
      </div>
      {right}
    </header>
  );
}

// ---------------------------------------------------------------- Početna
function Home({ b, today, now, weekFrom, weekTo, token, goSwap }: {
  b: Bundle; today: DateStr; now: number; weekFrom: DateStr; weekTo: DateStr; token: string; goSwap: () => void;
}) {
  const toast = useToast();
  const [pushOn, setPushOn] = useState(true);
  useEffect(() => { hasPushSubscription().then(setPushOn).catch(() => setPushOn(false)); }, []);

  const week = dateRange(weekFrom, weekTo);
  const mFrom = monthStart(today), mTo = monthEnd(today);
  const worked = workedMinutes(b.shifts, mFrom, mTo, now);
  const planned = workedMinutes(b.shifts, mFrom, mTo, Number.MAX_SAFE_INTEGER);
  const upcoming = b.shifts.filter((s) => s.date > weekTo).slice(0, 8);
  const absOn = (d: DateStr) => b.absences.find((a) => a.from <= d && a.to >= d);
  const weekMinutes = b.shifts.filter((s) => s.date >= weekFrom && s.date <= weekTo)
    .reduce((sum, s) => { const x = shiftBounds(s.date, { start_time: s.start, end_time: s.end }); return sum + x.end - x.start; }, 0);

  async function enablePush() {
    try {
      const s = await subscribePush();
      const { error } = await supabaseBrowser().rpc("w_save_push", { p_token: token, p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth });
      if (error) throw error;
      setPushOn(true);
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(APP.name, { body: "Obavijesti su uključene ✓", icon: "/icons/icon-192.png" });
    } catch (e) {
      toast(errMsg(e), "err");
    }
  }

  return (
    <main className="page">
      <Header
        b={b}
        right={
          <button className="icon-btn" onClick={enablePush} aria-label="Obavijesti">
            {pushOn ? <BellRing size={19} /> : <Bell size={19} />}
          </button>
        }
      />

      <InstallCard firstOpen={b.me.first_open} pushOn={pushOn} enablePush={enablePush} />

      {/* Tvoje smjene ovaj tjedan */}
      <section className="card hero stack" style={{ gap: 12 }}>
        <div className="row between" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="eyebrow">Tvoje smjene ovaj tjedan</div>
            <div className="big-num silver-text" style={{ fontSize: 36, marginTop: 6 }}>
              {toDate(weekFrom).getUTCDate()}.–{toDate(weekTo).getUTCDate()}. {MONTHS_GEN[toDate(weekTo).getUTCMonth()].slice(0, 3)}
            </div>
          </div>
          <div className="muted small" style={{ textAlign: "right" }}>{fmtHours(weekMinutes)} h<br />ovaj tjedan</div>
        </div>
        <div className="stack tight">
          {week.map((d) => {
            const shifts = b.shifts.filter((s) => s.date === d);
            const abs = absOn(d);
            const isToday = d === today;
            const past = d < today;
            return (
              <div key={d} className={`shift-line ${past ? "past" : ""}`} style={isToday ? { borderColor: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.08)" } : undefined}>
                <div style={{ width: 44 }}>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{toDate(d).getUTCDate()}.</div>
                  <div className="tiny faint" style={{ textTransform: "uppercase" }}>{isToday ? "danas" : WEEKDAYS_SHORT[isoWeekday(d) - 1]}</div>
                </div>
                {shifts.length ? <span className="bar" /> : null}
                <div style={{ flex: 1, minWidth: 0 }} className="stack tight">
                  {shifts.length ? shifts.map((s) => (
                    <div key={s.shift_template_id}>
                      <div style={{ fontWeight: 600 }}>{s.location} · {s.shift}</div>
                      <div className="small muted">{s.start} – {s.end}{s.coworkers.length ? ` · s tobom: ${s.coworkers.join(", ")}` : ""}</div>
                    </div>
                  )) : (
                    <div className="faint" style={{ paddingTop: 8 }}>{abs ? ABS[abs.type] : "Slobodno"}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid2">
        <section className="card stack" style={{ alignItems: "center", textAlign: "center", gap: 12, background: "linear-gradient(160deg,#1d1d22,#121215)" }}>
          <span className="glass-icon"><ArrowLeftRight size={28} /></span>
          <div style={{ fontWeight: 600 }}>Treba ti zamjena?</div>
          <button className="btn btn-primary btn-sm" onClick={goSwap}>Ponudi smjenu</button>
        </section>
        <section className="card stack" style={{ gap: 4 }}>
          <div className="big-num silver-text" style={{ fontSize: 36 }}>{fmtHours(worked)} h</div>
          <div className="muted small">Ovaj mjesec odrađeno</div>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <span className="tiny faint">od {fmtHours(planned)} h<br />u rasporedu</span>
            <Ring value={planned ? worked / planned : 0} />
          </div>
        </section>
      </div>

      <div className="section-head">
        <span className="title-sm">Sljedeće smjene</span>
      </div>
      {!upcoming.length && <div className="card empty">Nema objavljenih smjena nakon ovog tjedna.</div>}
      {upcoming.map((s) => {
        const days = Math.round((toDate(s.date).getTime() - toDate(today).getTime()) / 86_400_000);
        return (
          <section key={s.date + s.shift_template_id} className="card stack" style={{ padding: 14 }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }} className="stack tight">
                {s.coworkers.length > 0 && (
                  <div className="avatar-stack">{s.coworkers.slice(0, 4).map((c) => <Avatar key={c} name={c} size="sm" dim />)}</div>
                )}
                <div style={{ fontWeight: 600, fontSize: 19, lineHeight: 1.2 }}>{s.location} · {s.shift}</div>
                <div className="small muted">{WEEKDAYS_LONG[isoWeekday(s.date) - 1]} {fmtDM(s.date)} · {s.start}–{s.end}</div>
              </div>
              <div className="date-tile">
                <b>{toDate(s.date).getUTCDate()}</b>
                <span>{WEEKDAYS_SHORT[isoWeekday(s.date) - 1]}</span>
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="progress" style={{ flex: 1 }}>
                {Array.from({ length: 14 }, (_, i) => <i key={i} className={i < Math.max(0, 14 - days) ? "on" : ""} />)}
              </div>
              <span className="small muted" style={{ whiteSpace: "nowrap" }}>{days === 1 ? "sutra" : `za ${days} dana`}</span>
            </div>
          </section>
        );
      })}
    </main>
  );
}

function Ring({ value }: { value: number }) {
  const r = 31, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring">
      <svg width="74" height="74" viewBox="0 0 74 74">
        <circle cx="37" cy="37" r={r} stroke="rgba(255,255,255,0.1)" strokeWidth="5" fill="none" />
        <circle cx="37" cy="37" r={r} stroke="url(#silver)" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} />
        <defs><linearGradient id="silver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#8d8d96" /></linearGradient></defs>
      </svg>
      <div className="ring-center"><Clock size={20} strokeWidth={2.4} /></div>
    </div>
  );
}

/** Nakon prvog otvaranja: dodaj na početni zaslon + dozvoli obavijesti (kartica, ne skočni prozor). */
function InstallCard({ firstOpen, pushOn, enablePush }: { firstOpen: boolean; pushOn: boolean; enablePush: () => void }) {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(true);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());
    let dismissed = false;
    try { dismissed = localStorage.getItem("smjene.install.dismissed") === "1"; } catch { /* ignore */ }
    setHidden(dismissed && !firstOpen);
    const h = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, [firstOpen]);

  if (hidden || (standalone && pushOn)) return null;
  const dismiss = () => { try { localStorage.setItem("smjene.install.dismissed", "1"); } catch { /* ignore */ } setHidden(true); };
  const ios = isIOS();

  return (
    <section className="card stack" style={{ borderColor: "rgba(255,255,255,0.18)" }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span className="glass-icon" style={{ width: 48, height: 48, borderRadius: 16 }}><Smartphone size={22} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Spremi raspored na mobitel</div>
          <div className="small muted">Dodaj aplikaciju na početni zaslon i uključi obavijesti da odmah vidiš promjene.</div>
        </div>
        <button className="icon-btn sm" onClick={dismiss} aria-label="Sakrij"><X size={16} /></button>
      </div>
      {!standalone && (
        evt ? (
          <button className="btn btn-primary" onClick={async () => { await evt.prompt(); setEvt(null); }}><Plus size={17} /> Dodaj na početni zaslon</button>
        ) : (
          <div className="card-inner small muted">
            {ios
              ? <>U Safariju tapni <Share size={14} style={{ verticalAlign: -2 }} /> <b>Dijeli</b>, zatim <b>Dodaj na početni zaslon</b>. Obavijesti na iPhoneu rade tek kad aplikaciju otvoriš s početnog zaslona.</>
              : <>U izborniku preglednika (⋮) odaberi <b>Dodaj na početni zaslon</b> ili <b>Instaliraj aplikaciju</b>.</>}
          </div>
        )
      )}
      {!pushOn && (!ios || standalone) && (
        <button className="btn btn-ghost" onClick={enablePush}><Bell size={17} /> Uključi obavijesti</button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Zamjene
function Swaps({ b, today, now, act }: { b: Bundle; today: DateStr; now: number; act: (p: Record<string, unknown>, ok: string) => Promise<void> }) {
  const [offering, setOffering] = useState<string | null>(null);
  const offers = b.swaps.filter((s) => s.can_accept);
  const mine = b.swaps.filter((s) => s.mine || s.accepted_by_me);
  const openKeys = new Set(b.swaps.filter((s) => s.mine && (s.status === "ponudeno" || s.status === "prihvaceno")).map((s) => s.date + s.shift_template_id));
  const future = b.shifts.filter((s) => s.date >= today && shiftBounds(s.date, { start_time: s.start, end_time: s.end }).start > now);

  return (
    <main className="page">
      <Header b={b} />

      <section className="card hero stack">
        <div className="eyebrow">Zamjene</div>
        <div className="small muted">Ponudi smjenu svima ili određenom kolegi. Kad kolega prihvati, poslodavac odobri jednim tapom i raspored se sam ažurira.</div>
      </section>

      {offers.length > 0 && (
        <>
          <div className="section-head"><span className="title-sm">Ponude za tebe</span></div>
          {offers.map((s) => (
            <section key={s.id} className="card stack">
              <div className="row">
                <Avatar name={s.from_name} size="sm" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{s.from_name} nudi {s.location} · {s.shift}</div>
                  <div className="small muted">{fmtShort(s.date)} · {s.start}–{s.end}</div>
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => act({ action: "accept", id: s.id }, "Prihvaćeno — čeka odobrenje")}>
                <Check size={17} /> Prihvati
              </button>
            </section>
          ))}
        </>
      )}

      <div className="section-head"><span className="title-sm">Moje smjene</span></div>
      {!future.length && <div className="card empty">Nema nadolazećih smjena.</div>}
      {future.map((s) => {
        const k = s.date + s.shift_template_id;
        const offered = openKeys.has(k);
        return (
          <section key={k} className="card stack" style={{ padding: 14 }}>
            <div className="row">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{s.location} · {s.shift}</div>
                <div className="small muted">{fmtShort(s.date)} · {s.start}–{s.end}</div>
              </div>
              {offered ? (
                <span className="pill">Ponuđeno</span>
              ) : (
                <button className={`btn btn-sm ${offering === k ? "btn-ghost" : "btn-dark"}`} onClick={() => setOffering(offering === k ? null : k)}>
                  {offering === k ? "Odustani" : "Ponudi"}
                </button>
              )}
            </div>
            {offering === k && (
              <div className="hscroll">
                <button className="pill on" onClick={() => { setOffering(null); act({ action: "offer", date: s.date, shiftTemplateId: s.shift_template_id }, "Ponuđeno svima"); }}>
                  Svima
                </button>
                {b.colleagues.filter((c) => !s.coworkers.includes(c.name)).map((c) => (
                  <button key={c.id} className="pill" onClick={() => { setOffering(null); act({ action: "offer", date: s.date, shiftTemplateId: s.shift_template_id, toEmployeeId: c.id }, `Ponuđeno: ${c.name}`); }}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {mine.length > 0 && (
        <>
          <div className="section-head"><span className="title-sm">Status</span></div>
          <section className="card stack">
            {mine.map((s) => (
              <div key={s.id} className="row">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }} className="small">
                    {s.mine ? `${s.location} · ${s.shift} → ${s.accepted_name ?? s.to_name ?? "svima"}` : `Preuzimaš od: ${s.from_name} · ${s.location} ${s.shift}`}
                  </div>
                  <div className="tiny faint">{fmtShort(s.date)} · {s.start}–{s.end}</div>
                </div>
                <span className="pill" style={{ height: 28 }}>{STATUS[s.status]}</span>
                {s.mine && (s.status === "ponudeno" || s.status === "prihvaceno") && (
                  <button className="icon-btn sm" aria-label="Povuci ponudu" onClick={() => act({ action: "cancel", id: s.id }, "Ponuda povučena")}><X size={15} /></button>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- Ne mogu raditi
function Availability({ b, token, today, reload }: { b: Bundle; token: string; today: DateStr; reload: () => Promise<void> }) {
  const toast = useToast();
  const [date, setDate] = useState(addDays(today, 1));
  const [note, setNote] = useState("");
  const weekly = useMemo(() => new Map(b.availability.filter((a) => a.weekday).map((a) => [a.weekday!, a.id])), [b.availability]);
  const dates = b.availability.filter((a) => a.date);

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    const { error } = await supabaseBrowser().rpc(fn, { p_token: token, ...args });
    if (error) return toast(error.message, "err");
    toast(ok);
    await reload();
  }

  return (
    <main className="page">
      <Header b={b} />
      <section className="card hero stack">
        <div className="eyebrow">Ne mogu raditi</div>
        <div className="small muted">Poslodavac će vidjeti upozorenje ako te ipak rasporedi.</div>
      </section>

      <section className="card stack">
        <div className="title-sm">Stalno</div>
        <div className="small faint">Tapni dan u tjednu kad nikad ne možeš.</div>
        <div className="row wrap" style={{ gap: 8 }}>
          {WEEKDAYS_SHORT.map((w, i) => {
            const id = weekly.get(i + 1);
            return (
              <button
                key={w} className={`pill ${id ? "on" : ""}`}
                onClick={() => id
                  ? rpc("w_remove_unavailability", { p_id: id }, "Uklonjeno")
                  : rpc("w_add_unavailability", { p_date: null, p_weekday: i + 1, p_note: null }, `Spremljeno: ${WEEKDAYS_INSTR[i]} ne možeš`)}
              >
                {w}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card stack">
        <div className="title-sm">Određeni datum</div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="icon-btn" aria-label="Dodaj datum" disabled={!date}
            onClick={() => rpc("w_add_unavailability", { p_date: date, p_weekday: null, p_note: note || null }, "Spremljeno").then(() => setNote(""))}>
            <Plus size={18} />
          </button>
        </div>
        <input className="input sm" placeholder="Razlog (nije obavezno)" value={note} onChange={(e) => setNote(e.target.value)} />
        {dates.map((a) => (
          <div key={a.id} className="card-inner row">
            <span style={{ flex: 1 }}>{fmtShort(a.date!)}{a.note ? <span className="faint"> · {a.note}</span> : null}</span>
            <button className="icon-btn sm" aria-label="Ukloni" onClick={() => rpc("w_remove_unavailability", { p_id: a.id }, "Uklonjeno")}><X size={15} /></button>
          </div>
        ))}
      </section>

      {b.absences.length > 0 && (
        <section className="card stack">
          <div className="title-sm">Odsutnosti</div>
          {b.absences.filter((a) => a.to >= today).map((a) => (
            <div key={a.id} className="row small">
              <span style={{ flex: 1 }}>{ABS[a.type]}</span>
              <span className="muted">{a.from === a.to ? fmtShort(a.from) : `${fmtDM(a.from)} – ${fmtDM(a.to)}`}</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
