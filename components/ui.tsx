"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Avatar({ name, size, dim }: { name: string; size?: "sm"; dim?: boolean }) {
  return <span className={`avatar ${size ?? ""} ${dim ? "dim" : ""}`}>{initials(name)}</span>;
}

export function Dot({ level }: { level: "red" | "yellow" | "info" | null | undefined }) {
  if (!level) return null;
  return <span className={`dot ${level}`} aria-label={level === "red" ? "upozorenje" : "napomena"} />;
}

/** Donji list. Zatvara se tapom izvan njega; ne prekida rad (bez potvrda). */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="grabber" />
        {children}
      </div>
    </>
  );
}

export interface DockItem {
  href?: string;
  onClick?: () => void;
  active?: boolean;
  icon: LucideIcon;
  label: string;
  badge?: number;
}

/** Plutajući crni bar s ikonama (prema dizajnu). */
export function Dock({ items }: { items: DockItem[] }) {
  const path = usePathname();
  return (
    <nav className="dock-wrap" aria-label="Glavni izbornik">
      <div className="dock">
        {items.map((it) => {
          const on = it.active ?? (it.href ? path.startsWith(it.href) : false);
          const inner = (
            <>
              <it.icon size={22} strokeWidth={on ? 2.2 : 1.8} />
              {!!it.badge && <span className="badge">{it.badge}</span>}
            </>
          );
          return it.href ? (
            <Link key={it.label} href={it.href} className={on ? "on" : ""} aria-label={it.label} aria-current={on ? "page" : undefined}>
              {inner}
            </Link>
          ) : (
            <button key={it.label} onClick={it.onClick} className={on ? "on" : ""} aria-label={it.label}>
              {inner}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ---------- Kratke poruke (bez skočnih prozora) ----------
type ToastFn = (msg: string, kind?: "ok" | "err") => void;
const ToastCtx = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback<ToastFn>((msg, kind = "ok") => {
    setT({ msg, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), kind === "err" ? 4500 : 2400);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast ${t.kind === "err" ? "err" : ""}`} role="status">{t.msg}</div>}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Nešto nije uspjelo. Pokušaj ponovno.";
}
