import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { pushToEmployees } from "@/lib/push-server";
import { fmtDM } from "@/lib/dates";

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Objava rasporeda za raspon + push radnicima čiji se raspored promijenio.
export async function POST(req: Request) {
  const { orgId, from, to } = await req.json().catch(() => ({}));
  if (typeof orgId !== "string" || !isDate(from) || !isDate(to) || to < from) {
    return NextResponse.json({ error: "Neispravan zahtjev" }, { status: 400 });
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("publish_range", { p_org: orgId, p_from: from, p_to: to });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  const changed = ((data ?? []) as string[]).filter(Boolean);
  let notified = 0;
  try {
    notified = await pushToEmployees(supabaseAdmin(), changed, (e) => ({
      title: "Raspored je ažuriran",
      body: `${e.name}, tvoje smjene za ${fmtDM(from)}–${fmtDM(to)} su promijenjene. Pogledaj raspored.`,
      tag: "raspored",
    }));
  } catch {
    // push nije kritičan za objavu
  }
  return NextResponse.json({ changed: changed.length, notified });
}
