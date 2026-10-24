"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, CalendarDays, Settings, Users } from "lucide-react";
import { Dock } from "@/components/ui";
import { db } from "@/lib/owner/data";
import type { OrgInfo } from "@/lib/owner/session";

const OrgCtx = createContext<OrgInfo | null>(null);

export function useOrg(): OrgInfo {
  const o = useContext(OrgCtx);
  if (!o) throw new Error("useOrg izvan OwnerShell");
  return o;
}

export function OwnerShell({ org, children }: { org: OrgInfo; children: React.ReactNode }) {
  const path = usePathname();
  const [pending, setPending] = useState(0);

  // Broj zamjena koje čekaju odobrenje (značka na ikoni).
  useEffect(() => {
    db()
      .from("swap_requests")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("status", "prihvaceno")
      .then(({ count }) => setPending(count ?? 0));
  }, [org.id, path]);

  return (
    <OrgCtx.Provider value={org}>
      {children}
      <Dock
        items={[
          { href: "/raspored", icon: CalendarDays, label: "Raspored" },
          { href: "/radnici", icon: Users, label: "Radnici" },
          { href: "/zamjene", icon: ArrowLeftRight, label: "Zamjene", badge: pending },
          { href: "/postavke", icon: Settings, label: "Postavke" },
        ]}
      />
    </OrgCtx.Provider>
  );
}
