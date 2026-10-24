"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { APP } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errMsg, useToast } from "@/components/ui";

export default function Prijava() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("greska")) toast("Link je istekao ili je već iskorišten. Zatraži novi.", "err");
  }, [toast]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) return toast("Kod nije ispravan ili je istekao.", "err");
    router.replace("/raspored");
  }

  return (
    <main className="page" style={{ justifyContent: "center", minHeight: "100dvh", paddingBottom: 40 }}>
      <div className="stack" style={{ gap: 6, padding: "0 4px 10px" }}>
        <span className="eyebrow">{APP.description}</span>
        <h1 className="title silver-text" style={{ fontSize: 44 }}>{APP.name}</h1>
      </div>

      <div className="card hero stack" style={{ gap: 14 }}>
        {!sent ? (
          <form onSubmit={send} className="stack" style={{ gap: 14 }}>
            <div className="row">
              <span className="glass-icon" style={{ width: 48, height: 48, borderRadius: 16 }}><Mail size={22} /></span>
              <div>
                <div className="title-sm">Prijava vlasnika</div>
                <div className="small muted">Poslat ćemo ti link i kod na email.</div>
              </div>
            </div>
            <input
              className="input" type="email" required autoComplete="email" inputMode="email"
              placeholder="tvoj@email.com" value={email} onChange={(e) => setEmail(e.target.value)}
            />
            <button className="btn btn-primary btn-block" disabled={busy || !email}>
              Pošalji link <ArrowRight size={18} />
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="stack" style={{ gap: 14 }}>
            <div>
              <div className="title-sm">Provjeri email</div>
              <div className="small muted">
                Otvori link iz poruke poslane na <b>{email}</b> — ili upiši kod iz iste poruke ovdje
                (najbolje ako si aplikaciju dodao na početni zaslon).
              </div>
            </div>
            <input
              className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="Kod iz emaila"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} maxLength={10}
              style={{ letterSpacing: "0.3em", textAlign: "center", fontSize: 22 }}
            />
            <button className="btn btn-primary btn-block" disabled={busy || code.length < 6}>Prijavi se</button>
            <button type="button" className="link-btn" style={{ alignSelf: "center" }} onClick={() => setSent(false)}>
              Drugi email
            </button>
          </form>
        )}
      </div>
      <p className="note">Radnici se ne prijavljuju ovdje — oni dobivaju osobni link od tebe.</p>
    </main>
  );
}
